<#
.SYNOPSIS
    Initializes Azure resources for the Hybrid Entra ID SSO Integration Suite.
.DESCRIPTION
    This script creates or updates a resource group, a storage account, a key vault,
    an App Service Plan, and a Web App (or Function App).
    It's intended as a starting point for Azure resource deployment.
.PARAMETER TenantId
    The ID of the Azure Tenant.
.PARAMETER SubscriptionId
    The ID of the Azure Subscription.
.PARAMETER ResourceGroupName
    The name for the Azure Resource Group.
.PARAMETER StorageAccountName
    The globally unique name for the Azure Storage Account.
.PARAMETER KeyVaultName
    The globally unique name for the Azure Key Vault.
.PARAMETER AppServicePlanName
    The name for the Azure App Service Plan.
.PARAMETER WebAppName
    The globally unique name for the Azure Web App.
.PARAMETER Location
    The Azure region where resources will be deployed (e.g., 'EastUS').
.NOTES
    Version: 0.3
    Author: AI Assistant
.EXAMPLE
    ./Initialize-AzureResources.ps1 -TenantId "your-tenant-id" `
        -SubscriptionId "your-subscription-id" `
        -ResourceGroupName "MySSOResources" `
        -StorageAccountName "myssostorageaccountunique" `
        -KeyVaultName "myssokeyvaultunique" `
        -AppServicePlanName "MySSOAppPlan" `
        -WebAppName "myssowebappunique" `
        -Location "EastUS"
#>

param (
    [Parameter(Mandatory=$true)]
    [string]$TenantId,

    [Parameter(Mandatory=$true)]
    [string]$SubscriptionId,

    [Parameter(Mandatory=$true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory=$true)]
    [string]$StorageAccountName,

    [Parameter(Mandatory=$true)]
    [string]$KeyVaultName,

    [Parameter(Mandatory=$true)]
    [string]$AppServicePlanName,

    [Parameter(Mandatory=$true)]
    [string]$WebAppName,

    [Parameter(Mandatory=$true)]
    [string]$Location = "EastUS"
)

# --- Utility function to check Az module and connect ---
function Connect-ToAzureTenant {
    param (
        [string]$RequiredTenantId,
        [string]$RequiredSubscriptionId
    )
    try {
        Write-Host "Checking for Azure PowerShell module..."
        if (-not (Get-Module -Name Az -ListAvailable)) {
            Write-Error "Azure PowerShell module (Az) not found. Please install it first."
            throw "Az module not installed."
        }

        $currentContext = Get-AzContext -ErrorAction SilentlyContinue
        if ($null -eq $currentContext -or $currentContext.Tenant.Id -ne $RequiredTenantId -or $currentContext.Subscription.Id -ne $RequiredSubscriptionId) {
            Write-Host "Attempting to connect to Azure. Tenant: $RequiredTenantId, Subscription: $RequiredSubscriptionId."
            Connect-AzAccount -Tenant $RequiredTenantId -SubscriptionId $RequiredSubscriptionId -ErrorAction Stop
        } else {
            Write-Host "Already connected to the correct Azure Tenant ($($currentContext.Tenant.Id)) and Subscription ($($currentContext.Subscription.Id))."
        }
        Set-AzContext -SubscriptionId $RequiredSubscriptionId -ErrorAction Stop
        Write-Host "Successfully set context to Subscription: $RequiredSubscriptionId"
    }
    catch {
        Write-Error "Failed to connect to Azure or set context: $($_.Exception.Message)"
        throw # Re-throw the exception to stop the script
    }
}

# --- Main Script Logic ---
try {
    Connect-ToAzureTenant -RequiredTenantId $TenantId -RequiredSubscriptionId $SubscriptionId

    Write-Host "Starting Azure resource initialization in location '$Location'..."

    # Create Resource Group
    Write-Host "Checking for existing Resource Group: $ResourceGroupName..."
    $rg = Get-AzResourceGroup -Name $ResourceGroupName -ErrorAction SilentlyContinue
    if ($null -eq $rg) {
        Write-Host "Creating Resource Group: $ResourceGroupName in $Location..."
        New-AzResourceGroup -Name $ResourceGroupName -Location $Location -ErrorAction Stop
        Write-Host "Resource Group $ResourceGroupName created successfully."
    } else {
        Write-Host "Resource Group $ResourceGroupName already exists in $($rg.Location)."
    }

    # Create Storage Account
    Write-Host "Checking for existing Storage Account: $StorageAccountName..."
    $sa = Get-AzStorageAccount -ResourceGroupName $ResourceGroupName -Name $StorageAccountName -ErrorAction SilentlyContinue
    if ($null -eq $sa) {
        Write-Host "Creating Storage Account: $StorageAccountName..."
        New-AzStorageAccount -ResourceGroupName $ResourceGroupName `
            -Name $StorageAccountName `
            -Location $Location `
            -SkuName Standard_LRS `
            -Kind StorageV2 `
            -ErrorAction Stop
        Write-Host "Storage Account $StorageAccountName created successfully."
    } else {
        Write-Host "Storage Account $StorageAccountName already exists."
    }

    # Create Key Vault
    Write-Host "Checking for existing Key Vault: $KeyVaultName..."
    $kv = Get-AzKeyVault -VaultName $KeyVaultName -ResourceGroupName $ResourceGroupName -ErrorAction SilentlyContinue
    if ($null -eq $kv) {
        Write-Host "Creating Key Vault: $KeyVaultName..."
        New-AzKeyVault -VaultName $KeyVaultName `
            -ResourceGroupName $ResourceGroupName `
            -Location $Location `
            -Sku Standard `
            -EnableRbacAuthorization $true ` # Recommended for new Key Vaults
            -ErrorAction Stop
        Write-Host "Key Vault $KeyVaultName created successfully."
    } else {
        Write-Host "Key Vault $KeyVaultName already exists."
    }

    # Create App Service Plan
    Write-Host "Checking for existing App Service Plan: $AppServicePlanName..."
    $asp = Get-AzAppServicePlan -ResourceGroupName $ResourceGroupName -Name $AppServicePlanName -ErrorAction SilentlyContinue
    if ($null -eq $asp) {
        Write-Host "Creating App Service Plan: $AppServicePlanName..."
        New-AzAppServicePlan -ResourceGroupName $ResourceGroupName `
            -Name $AppServicePlanName `
            -Location $Location `
            -Tier Basic # Or Standard, PremiumV2, etc. e.g. B1, S1
            -Sku B1 `
            -ErrorAction Stop
        Write-Host "App Service Plan $AppServicePlanName created successfully."
    } else {
        Write-Host "App Service Plan $AppServicePlanName already exists."
    }

    # Create Web App (Node.js example)
    # For a Function App, use New-AzFunctionApp
    Write-Host "Checking for existing Web App: $WebAppName..."
    $webApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name $WebAppName -ErrorAction SilentlyContinue
    if ($null -eq $webApp) {
        Write-Host "Creating Web App: $WebAppName..."
        # For Node, common runtimes: "NODE|14-lts", "NODE|16-lts", "NODE|18-lts"
        # For other runtimes: "DOTNETCORE|6.0", "PYTHON|3.9", "JAVA|11-java11"
        New-AzWebApp -ResourceGroupName $ResourceGroupName `
            -Name $WebAppName `
            -Location $Location `
            -AppServicePlan $AppServicePlanName `
            -Runtime "NODE|18-lts" `
            -ErrorAction Stop
        Write-Host "Web App $WebAppName created successfully."
    } else {
        Write-Host "Web App $WebAppName already exists."
    }

    # TODO: Add Bicep/ARM template deployment logic for more complex setups for better maintainability.
    # TODO: Configure Key Vault access policies or RBAC for the Web App's Managed Identity.
    # TODO: Set application settings for the Web App (e.g., Key Vault URI, database connection strings).

    Write-Host "Azure resource initialization script execution completed successfully."
}
catch {
    Write-Error "An error occurred during Azure resource initialization: $($_.Exception.Message)"
    Write-Error "Script execution failed."
    # Exit with a non-zero status code to indicate failure
    exit 1
}
