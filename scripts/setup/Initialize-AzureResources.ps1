<#
.SYNOPSIS
    Initializes basic Azure resources for the Hybrid Entra ID SSO Integration Suite.
.DESCRIPTION
    This script creates a new resource group and a general-purpose storage account within that group.
    It's intended as a starting point for Azure resource deployment.
.PARAMETER TenantId
    The ID of the Azure Tenant.
.PARAMETER SubscriptionId
    The ID of the Azure Subscription.
.PARAMETER ResourceGroupName
    The name for the new Azure Resource Group.
.PARAMETER StorageAccountName
    The globally unique name for the new Azure Storage Account.
.PARAMETER Location
    The Azure region where resources will be deployed (e.g., 'EastUS').
.NOTES
    Version: 0.2
    Author: AI Assistant
.EXAMPLE
    ./Initialize-AzureResources.ps1 -TenantId "your-tenant-id" -SubscriptionId "your-subscription-id" -ResourceGroupName "MySSOResources" -StorageAccountName "myssostorageaccountunique" -Location "EastUS"
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
    [string]$Location = "EastUS"
)

# Login to Azure - consider using a service principal for automation
# For interactive use, Connect-AzAccount will prompt for login.
# If running in an automated pipeline, ensure authentication is handled (e.g., Managed Identity, Service Principal)
$currentContext = Get-AzContext
if ($null -eq $currentContext -or $currentContext.Tenant.Id -ne $TenantId -or $currentContext.Subscription.Id -ne $SubscriptionId) {
    Write-Host "Attempting to connect to Azure. If running interactively, a login prompt will appear."
    Connect-AzAccount -Tenant $TenantId -SubscriptionId $SubscriptionId -ErrorAction Stop
} else {
    Write-Host "Already connected to the correct Azure Tenant and Subscription."
}

Write-Host "Starting Azure resource initialization..."

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
    Write-Host "Creating Storage Account: $StorageAccountName in $Location (Resource Group: $ResourceGroupName)..."
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

# TODO: Add Bicep/ARM template deployment logic for more complex setups
# TODO: Add configuration steps for App Service, Key Vault, Function Apps, etc.

Write-Host "Azure resource initialization script execution completed."
