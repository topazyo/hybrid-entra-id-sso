<#
.SYNOPSIS
    Initializes Azure resources including RG, Storage, Key Vault (with a secret), App Service Plan, and Web App.
.DESCRIPTION
    This script creates or updates a resource group, a storage account, a key vault (and adds a secret to it),
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
.PARAMETER KeyVaultSecretName
    The name of the secret to create in the Key Vault. Defaults to "PlaceholderSecret".
.PARAMETER KeyVaultSecretValue
    The value for the secret created in the Key Vault. Defaults to "DefaultSecretValue_ChangeMe!".
    It's recommended to change this or pass a secure string for sensitive values.
.PARAMETER AppServicePlanName
    The name for the Azure App Service Plan.
.PARAMETER WebAppName
    The globally unique name for the Azure Web App.
.PARAMETER Location
    The Azure region where resources will be deployed (e.g., 'EastUS').
.NOTES
    Version: 0.4
.EXAMPLE
    ./Initialize-AzureResources.ps1 -TenantId "your-tenant-id" `
        -SubscriptionId "your-subscription-id" `
        -ResourceGroupName "MySSOResources" `
        -StorageAccountName "myssostorageaccountunique" `
        -KeyVaultName "myssokeyvaultunique" `
        -KeyVaultSecretName "WebAppApiKey" `
        -KeyVaultSecretValue "S0m3S3cureV@lu3" `
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

    [Parameter(Mandatory=$false)]
    [string]$KeyVaultSecretName = "PlaceholderSecret",

    [Parameter(Mandatory=$false)]
    [string]$KeyVaultSecretValue = "DefaultSecretValue_ChangeMe!", # Or use [System.Security.SecureString] for more security

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
        Write-Verbose "Checking for Azure PowerShell module..."
        if (-not (Get-Module -Name Az.Accounts -ListAvailable) -or -not (Get-Module -Name Az.Resources -ListAvailable) -or -not (Get-Module -Name Az.Storage -ListAvailable) -or -not (Get-Module -Name Az.KeyVault -ListAvailable) -or -not (Get-Module -Name Az.Websites -ListAvailable) ) {
            Write-Warning "One or more required Az modules (Accounts, Resources, Storage, KeyVault, Websites) not found. Ensure the full Az module is installed."
            if (-not (Get-Module -Name Az -ListAvailable)){
                 throw "Az module not installed."
            }
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
            -EnableRbacAuthorization $true `
            -ErrorAction Stop
        $kv = Get-AzKeyVault -VaultName $KeyVaultName -ResourceGroupName $ResourceGroupName # Ensure we have the KV object
        Write-Host "Key Vault $KeyVaultName created successfully."
    } else {
        Write-Host "Key Vault $KeyVaultName already exists."
    }

    # Add/Update secret in Key Vault
    if ($null -ne $kv) {
        Write-Host "Setting secret '$KeyVaultSecretName' in Key Vault '$($kv.VaultName)'..."
        # For sensitive values, $KeyVaultSecretValue should ideally be a SecureString
        # If $KeyVaultSecretValue is already a SecureString, use: -SecretValue $KeyVaultSecretValue
        # If it's plain text (as per param block now), convert it:
        $secretValueSecure = ConvertTo-SecureString $KeyVaultSecretValue -AsPlainText -Force
        Set-AzKeyVaultSecret -VaultName $kv.VaultName `
            -Name $KeyVaultSecretName `
            -SecretValue $secretValueSecure `
            -ErrorAction Stop
        Write-Host "Secret '$KeyVaultSecretName' set successfully in Key Vault '$($kv.VaultName)'."
    } else {
        Write-Warning "Skipping secret creation as Key Vault '$KeyVaultName' was not found or created."
    }

    # Create App Service Plan
    Write-Host "Checking for existing App Service Plan: $AppServicePlanName..."
    $asp = Get-AzAppServicePlan -ResourceGroupName $ResourceGroupName -Name $AppServicePlanName -ErrorAction SilentlyContinue
    if ($null -eq $asp) {
        Write-Host "Creating App Service Plan: $AppServicePlanName..."
        New-AzAppServicePlan -ResourceGroupName $ResourceGroupName `
            -Name $AppServicePlanName `
            -Location $Location `
            -Tier Basic `
            -Sku B1 `
            -ErrorAction Stop
        Write-Host "App Service Plan $AppServicePlanName created successfully."
    } else {
        Write-Host "App Service Plan $AppServicePlanName already exists."
    }

    # Create Web App (Node.js example)
    Write-Host "Checking for existing Web App: $WebAppName..."
    $webApp = Get-AzWebApp -ResourceGroupName $ResourceGroupName -Name $WebAppName -ErrorAction SilentlyContinue
    if ($null -eq $webApp) {
        Write-Host "Creating Web App: $WebAppName..."
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

    Write-Host "Azure resource initialization script execution completed successfully."
}
catch {
    Write-Error "An error occurred during Azure resource initialization: $($_.Exception.Message)"
    Write-Error "Script execution failed."
    exit 1
}
