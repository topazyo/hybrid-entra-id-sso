<#
.SYNOPSIS
    Initializes Azure Monitoring resources, focusing on Log Analytics Workspace.
.DESCRIPTION
    This script creates or ensures the existence of an Azure Log Analytics Workspace.
    Future enhancements will include configuring data sources, alert rules, and linking
    other resources for monitoring.
.PARAMETER WorkspaceName
    The name for the Azure Log Analytics Workspace.
.PARAMETER ResourceGroupName
    The name of the Azure Resource Group where the workspace will reside or be created.
.PARAMETER Location
    The Azure region for the Log Analytics Workspace. Required if creating a new workspace.
.PARAMETER TenantId
    The ID of the Azure Tenant. If not provided, script will attempt to use current context.
.PARAMETER SubscriptionId
    The ID of the Azure Subscription. If not provided, script will attempt to use current context.
.NOTES
    Version: 0.2
    Author: AI Assistant
.EXAMPLE
    ./Initialize-Monitoring.ps1 -WorkspaceName "MySsoLogAnalytics" -ResourceGroupName "MySSOResources" -Location "EastUS" -TenantId "your-tenant-id" -SubscriptionId "your-subscription-id"

.EXAMPLE
    # Using current Azure context if already logged in and set
    ./Initialize-Monitoring.ps1 -WorkspaceName "MySsoLogAnalytics" -ResourceGroupName "MySSOResources" -Location "EastUS"
#>

param (
    [Parameter(Mandatory=$true)]
    [string]$WorkspaceName,

    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory=$true)] # Location is mandatory for creation
    [string]$Location,

    [Parameter(Mandatory=$false)]
    [string]$TenantId,

    [Parameter(Mandatory=$false)]
    [string]$SubscriptionId
)

# --- Utility function to check Az module and connect ---
function Connect-ToAzureTenantIfNeeded {
    param (
        [string]$RequiredTenantId,
        [string]$RequiredSubscriptionId
    )
    try {
        Write-Verbose "Checking for Azure PowerShell module..."
        if (-not (Get-Module -Name Az.OperationalInsights -ListAvailable)) {
             Write-Warning "Az.OperationalInsights module not found. Attempting to ensure Az module is present."
             if (-not (Get-Module -Name Az -ListAvailable)) {
                Write-Error "Azure PowerShell module (Az) not found. Please install it first."
                throw "Az module not installed."
             }
        }

        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        $targetTenantId = if ([string]::IsNullOrWhiteSpace($RequiredTenantId)) { $currentContext.Tenant.Id } else { $RequiredTenantId }
        $targetSubscriptionId = if ([string]::IsNullOrWhiteSpace($RequiredSubscriptionId)) { $currentContext.Subscription.Id } else { $RequiredSubscriptionId }

        if ([string]::IsNullOrWhiteSpace($targetTenantId) -or [string]::IsNullOrWhiteSpace($targetSubscriptionId) ) {
            Write-Error "TenantId or SubscriptionId could not be determined from parameters or current context. Please login or provide them."
            throw "Azure context not set."
        }

        if ($null -eq $currentContext -or $currentContext.Tenant.Id -ne $targetTenantId -or $currentContext.Subscription.Id -ne $targetSubscriptionId) {
            Write-Host "Attempting to connect to Azure. Tenant: $targetTenantId, Subscription: $targetSubscriptionId."
            Connect-AzAccount -Tenant $targetTenantId -SubscriptionId $targetSubscriptionId -ErrorAction Stop
        } else {
            Write-Host "Already connected to the correct Azure Tenant ($($currentContext.Tenant.Id)) and Subscription ($($currentContext.Subscription.Id))."
        }
        Set-AzContext -SubscriptionId $targetSubscriptionId -ErrorAction Stop
        Write-Host "Successfully set context to Subscription: $targetSubscriptionId"
    }
    catch {
        Write-Error "Failed to connect to Azure or set context: $($_.Exception.Message)"
        throw # Re-throw the exception to stop the script
    }
}

# --- Main Script Logic ---
try {
    Connect-ToAzureTenantIfNeeded -RequiredTenantId $TenantId -RequiredSubscriptionId $SubscriptionId

    Write-Host "Starting Azure Monitoring Initialization for Log Analytics Workspace '$WorkspaceName'..."
    Write-Host "Resource Group: $ResourceGroupName"
    Write-Host "Location: $Location"
    Write-Host "--------------------------------------------------"

    # Check if the Resource Group exists, create if it doesn't
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
    if ($null -eq $rg) {
        Write-Host "Resource Group '$ResourceGroupName' not found. Creating it in '$Location'..."
        New-AzResourceGroup -Name $ResourceGroupName -Location $Location -ErrorAction Stop
        Write-Host "Resource Group '$ResourceGroupName' created successfully."
    } else {
        Write-Host "Resource Group '$ResourceGroupName' already exists in $($rg.Location)."
    }

    # Check for existing Log Analytics Workspace
    Write-Host "Checking for existing Log Analytics Workspace: $WorkspaceName in Resource Group $ResourceGroupName..."
    $workspace = Get-AzOperationalInsightsWorkspace -ResourceGroupName $ResourceGroupName -Name $WorkspaceName -ErrorAction SilentlyContinue

    if ($null -eq $workspace) {
        Write-Host "Log Analytics Workspace '$WorkspaceName' not found. Creating it..."
        New-AzOperationalInsightsWorkspace -ResourceGroupName $ResourceGroupName `
            -Name $WorkspaceName `
            -Location $Location `
            -Sku Standard ` # Other SKUs: PerGB2018, Free, Premium, etc.
            -ErrorAction Stop
        Write-Host "Log Analytics Workspace '$WorkspaceName' created successfully."
        $workspace = Get-AzOperationalInsightsWorkspace -ResourceGroupName $ResourceGroupName -Name $WorkspaceName # Get the created workspace object
    } else {
        Write-Host "Log Analytics Workspace '$WorkspaceName' already exists."
        Write-Host "  Workspace ID: $($workspace.CustomerId)"
        Write-Host "  Location: $($workspace.Location)"
        Write-Host "  SKU: $($workspace.Sku.Name)"
    }

    if ($null -ne $workspace) {
        Write-Host "--------------------------------------------------"
        Write-Host "Log Analytics Workspace '$($workspace.Name)' is ready."
        Write-Host "Workspace ID (CustomerId): $($workspace.CustomerId)"
        Write-Host "Primary Shared Key: (Run 'Get-AzOperationalInsightsWorkspaceSharedKeys -ResourceGroupName $ResourceGroupName -Name $WorkspaceName' to retrieve)"
        Write-Host "--------------------------------------------------"

        Write-Host "Placeholder for further monitoring configuration:"
        Write-Host "  - Configure Data Sources (e.g., Performance Counters, Event Logs, Azure Diagnostics)."
        Write-Host "    Example: Set-AzOperationalInsightsDataSource -ResourceGroupName $ResourceGroupName -WorkspaceName $WorkspaceName -Kind 'WindowsEvent' -Name 'Application Events' ..."
        Write-Host "  - Link Azure resources to this workspace for diagnostics logging."
        Write-Host "    Example: Set-AzDiagnosticSetting for various Azure resources."
        Write-Host "  - Create Alert Rules based on queries."
        Write-Host "    Example: New-AzScheduledQueryRule -ResourceGroupName $ResourceGroupName -Location $Location -ActionGroup $actionGroupId -AlertRuleName 'High CPU Alert' ..."
        Write-Host "  - Deploy Azure Monitor Agent to VMs and Arc-enabled servers."
        Write-Host "  - Configure Application Insights for applications and link to this workspace if desired."
    } else {
        Write-Error "Failed to create or retrieve Log Analytics Workspace '$WorkspaceName'."
    }

    Write-Host "--------------------------------------------------"
    Write-Host "Azure Monitoring Initialization script execution completed."

}
catch {
    Write-Error "An error occurred during Azure Monitoring initialization: $($_.Exception.Message)"
    Write-Error "Script execution failed."
    # Exit with a non-zero status code to indicate failure
    exit 1
}
