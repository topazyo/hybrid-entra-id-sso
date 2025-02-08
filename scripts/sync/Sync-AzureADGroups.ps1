[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$TenantId,
    
    [Parameter(Mandatory=$true)]
    [string]$SourceGroupPrefix,
    
    [Parameter(Mandatory=$true)]
    [string]$TargetGroupPrefix
)

class GroupSynchronizer {
    [string]$TenantId
    [string]$SourcePrefix
    [string]$TargetPrefix
    hidden [object]$Logger
    hidden [hashtable]$Statistics

    GroupSynchronizer([string]$tenantId, [string]$sourcePrefix, [string]$targetPrefix) {
        $this.TenantId = $tenantId
        $this.SourcePrefix = $sourcePrefix
        $this.TargetPrefix = $targetPrefix
        $this.InitializeLogger()
        $this.InitializeStatistics()
    }

    [void]InitializeLogger() {
        $logPath = Join-Path $PSScriptRoot "logs"
        if (-not (Test-Path $logPath)) {
            New-Item -ItemType Directory -Path $logPath
        }
        $this.Logger = @{
            Path = Join-Path $logPath "GroupSync.log"
            Write = {
                param($message, $level = "INFO")
                $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')|$level|$message"
                Add-Content -Path $this.Path -Value $logMessage
            }
        }
    }

    [void]InitializeStatistics() {
        $this.Statistics = @{
            GroupsProcessed = 0
            MembersAdded = 0
            MembersRemoved = 0
            Errors = 0
            StartTime = Get-Date
        }
    }

    [void]SynchronizeGroups() {
        try {
            # Connect to Azure AD
            Connect-MgGraph -TenantId $this.TenantId
            
            # Get source groups
            $sourceGroups = Get-MgGroup -Filter "startsWith(displayName,'$($this.SourcePrefix)')"
            
            foreach ($sourceGroup in $sourceGroups) {
                $this.SynchronizeGroup($sourceGroup)
                $this.Statistics.GroupsProcessed++
            }

            $this.GenerateReport()
        }
        catch {
            $this.Logger.Write.Invoke("Group synchronization failed: $_", "ERROR")
            $this.Statistics.Errors++
            throw
        }
        finally {
            Disconnect-MgGraph
        }
    }

    [void]SynchronizeGroup($sourceGroup) {
        try {
            $targetGroupName = $sourceGroup.displayName -replace "^$($this.SourcePrefix)", $this.TargetPrefix
            $targetGroup = Get-MgGroup -Filter "displayName eq '$targetGroupName'"

            if (-not $targetGroup) {
                $this.CreateTargetGroup($targetGroupName)
                return
            }

            $this.SynchronizeMembers($sourceGroup, $targetGroup)
        }
        catch {
            $this.Logger.Write.Invoke("Failed to sync group $($sourceGroup.displayName): $_", "ERROR")
            $this.Statistics.Errors++
        }
    }

    [void]SynchronizeMembers($sourceGroup, $targetGroup) {
        $sourceMembers = Get-MgGroupMember -GroupId $sourceGroup.Id
        $targetMembers = Get-MgGroupMember -GroupId $targetGroup.Id

        # Add missing members
        $membersToAdd = $sourceMembers | Where-Object { 
            $member = $_
            -not ($targetMembers | Where-Object { $_.Id -eq $member.Id })
        }

        foreach ($member in $membersToAdd) {
            try {
                New-MgGroupMember -GroupId $targetGroup.Id -DirectoryObjectId $member.Id
                $this.Statistics.MembersAdded++
            }
            catch {
                $this.Logger.Write.Invoke("Failed to add member to group: $_", "ERROR")
                $this.Statistics.Errors++
            }
        }

        # Remove extra members
        $membersToRemove = $targetMembers | Where-Object {
            $member = $_
            -not ($sourceMembers | Where-Object { $_.Id -eq $member.Id })
        }

        foreach ($member in $membersToRemove) {
            try {
                Remove-MgGroupMember -GroupId $targetGroup.Id -DirectoryObjectId $member.Id
                $this.Statistics.MembersRemoved++
            }
            catch {
                $this.Logger.Write.Invoke("Failed to remove member from group: $_", "ERROR")
                $this.Statistics.Errors++
            }
        }
    }

    [void]GenerateReport() {
        $this.Statistics.EndTime = Get-Date
        $this.Statistics.Duration = $this.Statistics.EndTime - $this.Statistics.StartTime

        $report = @"
Group Synchronization Report
===========================
Start Time: $($this.Statistics.StartTime)
End Time: $($this.Statistics.EndTime)
Duration: $($this.Statistics.Duration)

Statistics:
- Groups Processed: $($this.Statistics.GroupsProcessed)
- Members Added: $($this.Statistics.MembersAdded)
- Members Removed: $($this.Statistics.MembersRemoved)
- Errors: $($this.Statistics.Errors)
"@

        $reportPath = Join-Path $PSScriptRoot "reports/GroupSync_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
        $report | Set-Content $reportPath
    }
}

# Main execution
try {
    $synchronizer = [GroupSynchronizer]::new($TenantId, $SourceGroupPrefix, $TargetGroupPrefix)
    $synchronizer.SynchronizeGroups()
}
catch {
    Write-Error "Group synchronization failed: $_"
    exit 1
}