[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$LogAnalyticsWorkspaceId,
    
    [Parameter(Mandatory=$true)]
    [string]$LogAnalyticsKey
)

# Import required modules
Import-Module Az.Accounts
Import-Module Az.Monitor
Import-Module Az.OperationalInsights

class EntraIDHealthMonitor {
    [string]$TenantId
    [string]$WorkspaceId
    [string]$WorkspaceKey
    [object]$Metrics
    hidden [object]$Logger

    EntraIDHealthMonitor([string]$tenantId, [string]$workspaceId, [string]$workspaceKey) {
        $this.TenantId = $tenantId
        $this.WorkspaceId = $workspaceId
        $this.WorkspaceKey = $workspaceKey
        $this.InitializeLogger()
        $this.InitializeMetrics()
    }

    [void]InitializeLogger() {
        $logPath = Join-Path $PSScriptRoot "logs"
        if (-not (Test-Path $logPath)) {
            New-Item -ItemType Directory -Path $logPath
        }
        $this.Logger = @{
            Path = Join-Path $logPath "EntraIDHealth.log"
            Write = {
                param($message, $level = "INFO")
                $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')|$level|$message"
                Add-Content -Path $this.Path -Value $logMessage
            }
        }
    }

    [void]InitializeMetrics() {
        $this.Metrics = @{
            SyncStatus = $null
            FailedConnections = 0
            LastSuccessfulSync = $null
            ErrorCount = 0
        }
    }

    [void]CheckSyncHealth() {
        try {
            $syncStatus = Get-ADSyncScheduler
            $this.Metrics.LastSuccessfulSync = $syncStatus.LastSuccessfulSync
            
            if (-not $syncStatus.SyncCycleEnabled) {
                $this.LogWarning("Sync cycle is disabled")
            }

            # Check for recent sync errors
            $errors = Get-ADSyncRunStepResult | Where-Object {
                $_.Result -eq "failure" -and 
                $_.TimeEnded -gt (Get-Date).AddHours(-24)
            }
            
            $this.Metrics.ErrorCount = $errors.Count
            
            if ($errors.Count -gt 0) {
                $this.LogError("Found $($errors.Count) sync errors in the last 24 hours")
                $this.SendMetricsToLogAnalytics("SyncErrors", @{
                    ErrorCount = $errors.Count
                    LastError = $errors[0].StepResult
                })
            }
        }
        catch {
            $this.LogError("Failed to check sync health: $_")
            throw
        }
    }

    [void]SendMetricsToLogAnalytics([string]$MetricType, [hashtable]$MetricData) {
        $body = @{
            TimeGenerated = [DateTime]::UtcNow
            Type = $MetricType
            TenantId = $this.TenantId
        } + $MetricData

        $jsonBody = $body | ConvertTo-Json
        
        # Create the signature
        $date = [DateTime]::UtcNow.ToString("r")
        $contentLength = $jsonBody.Length
        $signature = $this.CreateSignature($contentLength, $date)

        $headers = @{
            "Authorization" = $signature
            "Log-Type" = "EntraIDHealth"
            "x-ms-date" = $date
            "time-generated-field" = "TimeGenerated"
        }

        $uri = "https://$($this.WorkspaceId).ods.opinsights.azure.com/api/logs?api-version=2016-04-01"

        try {
            Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json" -Headers $headers -Body $jsonBody
        }
        catch {
            $this.LogError("Failed to send metrics to Log Analytics: $_")
        }
    }

    hidden [string]CreateSignature([int]$contentLength, [string]$date) {
        $stringToSign = "POST`n$contentLength`napplication/json`nx-ms-date:$date`n/api/logs"
        $bytesToSign = [Text.Encoding]::UTF8.GetBytes($stringToSign)
        $keyBytes = [Convert]::FromBase64String($this.WorkspaceKey)
        $hmacsha256 = New-Object System.Security.Cryptography.HMACSHA256
        $hmacsha256.Key = $keyBytes
        $signature = [Convert]::ToBase64String($hmacsha256.ComputeHash($bytesToSign))
        return "SharedKey $($this.WorkspaceId):$signature"
    }

    [void]LogError([string]$message) {
        $this.Logger.Write.Invoke($message, "ERROR")
    }

    [void]LogWarning([string]$message) {
        $this.Logger.Write.Invoke($message, "WARNING")
    }
}

# Main execution
try {
    $monitor = [EntraIDHealthMonitor]::new($TenantId, $LogAnalyticsWorkspaceId, $LogAnalyticsKey)
    
    # Run initial health check
    $monitor.CheckSyncHealth()
    
    # Set up continuous monitoring
    $job = Start-Job -ScriptBlock {
        param($monitor)
        while ($true) {
            $monitor.CheckSyncHealth()
            Start-Sleep -Seconds 300 # Check every 5 minutes
        }
    } -ArgumentList $monitor

    # Keep the script running
    try {
        while ($true) {
            if ($job.State -ne "Running") {
                throw "Monitoring job stopped unexpectedly"
            }
            Start-Sleep -Seconds 60
        }
    }
    finally {
        Stop-Job $job
        Remove-Job $job
    }
}
catch {
    Write-Error "Monitoring failed: $_"
    exit 1
}