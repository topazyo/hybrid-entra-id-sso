[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,
    
    [Parameter()]
    [int]$MonitoringInterval = 300 # 5 minutes
)

# Import required modules
Import-Module Az.Accounts
Import-Module Az.Monitor
Import-Module Az.OperationalInsights

class EntraIDSyncMonitor {
    [string]$TenantId
    [string]$SubscriptionId
    [int]$Interval
    [object]$Metrics
    hidden [object]$Logger

    EntraIDSyncMonitor([string]$tenantId, [string]$subscriptionId, [int]$interval) {
        $this.TenantId = $tenantId
        $this.SubscriptionId = $subscriptionId
        $this.Interval = $interval
        $this.InitializeLogger()
        $this.InitializeMetrics()
    }

    [void]InitializeLogger() {
        $logPath = Join-Path $PSScriptRoot "logs"
        if (-not (Test-Path $logPath)) {
            New-Item -ItemType Directory -Path $logPath
        }
        $this.Logger = @{
            Path = Join-Path $logPath "SyncMonitor.log"
            Write = {
                param($message, $level = "INFO")
                $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')|$level|$message"
                Add-Content -Path $this.Path -Value $logMessage
            }
        }
    }

    [void]InitializeMetrics() {
        $this.Metrics = @{
            LastSyncTime = $null
            FailedExports = 0
            IdentityMismatches = 0
            SyncErrors = @()
        }
    }

    [void]StartMonitoring() {
        try {
            # Connect to Azure
            Connect-AzAccount -TenantId $this.TenantId -SubscriptionId $this.SubscriptionId

            while ($true) {
                $this.CheckSyncHealth()
                Start-Sleep -Seconds $this.Interval
            }
        }
        catch {
            $this.Logger.Write.Invoke("Monitoring failed: $_", "ERROR")
            throw
        }
    }

    [void]CheckSyncHealth() {
        try {
            # Check sync status
            $syncStatus = Get-ADSyncScheduler
            $this.Metrics.LastSyncTime = $syncStatus.LastSuccessfulSync

            # Check for sync errors
            $errors = Get-ADSyncRunStepResult | Where-Object {
                $_.Result -eq "failure" -and 
                $_.TimeEnded -gt (Get-Date).AddHours(-24)
            }
            
            $this.Metrics.SyncErrors = $errors

            if ($errors.Count -gt 0) {
                $this.HandleSyncErrors($errors)
            }

            # Check for identity mismatches
            $mismatches = $this.CheckIdentityMismatches()
            $this.Metrics.IdentityMismatches = $mismatches.Count

            if ($mismatches.Count -gt 0) {
                $this.HandleIdentityMismatches($mismatches)
            }

            $this.LogMetrics()
        }
        catch {
            $this.Logger.Write.Invoke("Health check failed: $_", "ERROR")
        }
    }

    [array]CheckIdentityMismatches() {
        $adUsers = Get-ADUser -Filter * -Properties userPrincipalName, mail
        $aadUsers = Get-AzureADUser -All $true

        $mismatches = @()

        foreach ($adUser in $adUsers) {
            $aadUser = $aadUsers | Where-Object { $_.UserPrincipalName -eq $adUser.UserPrincipalName }
            if ($aadUser -and ($adUser.mail -ne $aadUser.Mail)) {
                $mismatches += @{
                    UserPrincipalName = $adUser.UserPrincipalName
                    ADMail = $adUser.mail
                    AADMail = $aadUser.Mail
                }
            }
        }

        return $mismatches
    }

    [void]HandleSyncErrors($errors) {
        foreach ($error in $errors) {
            $this.Logger.Write.Invoke("Sync error detected: $($error.StepResult)", "ERROR")
        }

        # Send alert
        $alertBody = @{
            ErrorCount = $errors.Count
            Details = $errors | ConvertTo-Json
            Timestamp = Get-Date
        }

        # Implement alert sending logic
    }

    [void]LogMetrics() {
        $metrics = @{
            LastSyncTime = $this.Metrics.LastSyncTime
            ErrorCount = $this.Metrics.SyncErrors.Count
            MismatchCount = $this.Metrics.IdentityMismatches
            Timestamp = Get-Date
        }

        $this.Logger.Write.Invoke(($metrics | ConvertTo-Json))
    }
}

# Main execution
try {
    $monitor = [EntraIDSyncMonitor]::new($TenantId, $SubscriptionId, $MonitoringInterval)
    $monitor.StartMonitoring()
}
catch {
    Write-Error "Monitoring failed: $_"
    exit 1
}