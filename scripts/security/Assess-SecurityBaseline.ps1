[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,
    
    [Parameter()]
    [string]$BaselinePath = ".\baselines\security-baseline.json"
)

class SecurityBaselineAssessor {
    [string]$TenantId
    [string]$SubscriptionId
    [string]$BaselinePath
    [hashtable]$Baseline
    [hashtable]$Results
    hidden [object]$Logger

    SecurityBaselineAssessor(
        [string]$tenantId,
        [string]$subscriptionId,
        [string]$baselinePath
    ) {
        $this.TenantId = $tenantId
        $this.SubscriptionId = $subscriptionId
        $this.BaselinePath = $baselinePath
        $this.InitializeLogger()
        $this.LoadBaseline()
        $this.Results = @{
            PassedChecks = 0
            FailedChecks = 0
            Warnings = 0
            Details = @()
        }
    }

    [void]InitializeLogger() {
        $logPath = Join-Path $PSScriptRoot "logs"
        if (-not (Test-Path $logPath)) {
            New-Item -ItemType Directory -Path $logPath
        }
        $this.Logger = @{
            Path = Join-Path $logPath "SecurityAssessment.log"
            Write = {
                param($message, $level = "INFO")
                $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')|$level|$message"
                Add-Content -Path $this.Path -Value $logMessage
            }
        }
    }

    [void]LoadBaseline() {
        try {
            $this.Baseline = Get-Content $this.BaselinePath | ConvertFrom-Json -AsHashtable
        }
        catch {
            $this.Logger.Write.Invoke("Failed to load baseline: $_", "ERROR")
            throw
        }
    }

    [void]AssessCompliance() {
        try {
            # Connect to Azure
            Connect-AzAccount -TenantId $this.TenantId -SubscriptionId $this.SubscriptionId

            # Assess identity settings
            $this.AssessIdentitySettings()

            # Assess network security
            $this.AssessNetworkSecurity()

            # Assess encryption settings
            $this.AssessEncryptionSettings()

            # Generate report
            $this.GenerateReport()
        }
        catch {
            $this.Logger.Write.Invoke("Assessment failed: $_", "ERROR")
            throw
        }
        finally {
            Disconnect-AzAccount
        }
    }

    [void]AssessIdentitySettings() {
        # Check MFA enforcement
        $mfaPolicy = Get-MgPolicyAuthenticationMethodPolicy
        $this.AssessControl(
            "MFA_Enforcement",
            { $mfaPolicy.State -eq "enabled" },
            "MFA should be enabled for all users"
        )

        # Check password policy
        $passwordPolicy = Get-MgPolicyAuthenticationMethodPolicyAuthenticationMethod
        $this.AssessControl(
            "Password_Policy",
            { 
                $passwordPolicy.PasswordComplexity -eq "strong" -and
                $passwordPolicy.MinimumPasswordLength -ge 12
            },
            "Password policy should meet minimum requirements"
        )
    }

    [void]AssessNetworkSecurity() {
        # Check network security groups
        $nsgs = Get-AzNetworkSecurityGroup
        foreach ($nsg in $nsgs) {
            $this.AssessControl(
                "NSG_$($nsg.Name)",
                { -not ($nsg.SecurityRules | Where-Object { $_.Access -eq 'Allow' -and $_.SourceAddressPrefix -eq '*' }) },
                "NSG should not allow unrestricted access"
            )
        }
    }

    [void]AssessControl(
        [string]$controlName,
        [scriptblock]$evaluation,
        [string]$description
    ) {
        try {
            $result = & $evaluation
            if ($result) {
                $this.Results.PassedChecks++
                $status = "Passed"
            }
            else {
                $this.Results.FailedChecks++
                $status = "Failed"
            }

            $this.Results.Details += @{
                Control = $controlName
                Status = $status
                Description = $description
                Timestamp = Get-Date
            }
        }
        catch {
            $this.Logger.Write.Invoke("Control assessment failed: $_", "ERROR")
            $this.Results.Warnings++
        }
    }

    [void]GenerateReport() {
        $report = @"
Security Baseline Assessment Report
=================================
Generated: $(Get-Date)
Tenant ID: $($this.TenantId)

Summary:
--------
Passed Checks: $($this.Results.PassedChecks)
Failed Checks: $($this.Results.FailedChecks)
Warnings: $($this.Results.Warnings)

Detailed Results:
----------------
$($this.Results.Details | ForEach-Object {
    "Control: $($_.Control)`nStatus: $($_.Status)`nDescription: $($_.Description)`n"
})
"@

        $reportPath = Join-Path $PSScriptRoot "reports/SecurityAssessment_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
        $report | Set-Content $reportPath
    }
}

# Main execution
try {
    $assessor = [SecurityBaselineAssessor]::new($TenantId, $SubscriptionId, $BaselinePath)
    $assessor.AssessCompliance()
}
catch {
    Write-Error "Security baseline assessment failed: $_"
    exit 1
}