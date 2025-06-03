<#
.SYNOPSIS
    Generates a self-signed X.509 certificate.
.DESCRIPTION
    This script creates a self-signed certificate, primarily for development and testing purposes.
    It can save the certificate to a .pfx file and/or install it to the user's certificate store.
.PARAMETER CommonName
    The subject common name for the certificate (e.g., 'sso.contoso.com').
.PARAMETER DnsName
    Additional DNS names (Subject Alternative Names) for the certificate. Can be a comma-separated list.
.PARAMETER CertPath
    The directory path where the .pfx file will be saved. Default is './certificates'.
.PARAMETER CertFileName
    The file name for the .pfx certificate file (without extension). Default is the CommonName.
.PARAMETER CertPassword
    The password to protect the .pfx file. A secure string is recommended. If not provided, a random one is generated.
.PARAMETER ValidityDays
    The number of days the certificate will be valid. Default is 365.
.PARAMETER InstallToUserStore
    If $true, installs the certificate to the CurrentUser\My certificate store. Default is $false.
.NOTES
    Version: 0.2
    Author: AI Assistant
.EXAMPLE
    ./Generate-Certificates.ps1 -CommonName "dev.hybrid.sso" -DnsName "localhost,dev.hybrid.sso" -CertPath "./mycerts" -ValidityDays 730 -InstallToUserStore $true

.EXAMPLE
    $securePassword = ConvertTo-SecureString "MySuperSecretP@sswOrd!" -AsPlainText -Force
    ./Generate-Certificates.ps1 -CommonName "test.sso.local" -CertPassword $securePassword
#>

param (
    [Parameter(Mandatory=$true)]
    [string]$CommonName,

    [string[]]$DnsName,

    [string]$CertPath = "./certificates",

    [string]$CertFileName,

    [System.Security.SecureString]$CertPassword,

    [int]$ValidityDays = 365,

    [switch]$InstallToUserStore = $false
)

Write-Host "Starting certificate generation process..."

# Set default DNS Name if not provided
if ($null -eq $DnsName -or $DnsName.Count -eq 0) {
    $DnsName = @($CommonName)
} elseif ($CommonName -notin $DnsName) {
    $DnsName += $CommonName # Ensure CommonName is always in DNS names
}

# Set default certificate file name
if ([string]::IsNullOrWhiteSpace($CertFileName)) {
    $CertFileName = $CommonName -replace '[^a-zA-Z0-9.-]', '_' # Sanitize CN for filename
}

# Create certificate directory if it doesn't exist
if (-not (Test-Path -Path $CertPath)) {
    Write-Host "Creating certificate directory: $CertPath"
    New-Item -ItemType Directory -Path $CertPath -ErrorAction Stop
}

$fullCertPathPfx = Join-Path -Path $CertPath -ChildPath "$($CertFileName).pfx"
$fullCertPathCer = Join-Path -Path $CertPath -ChildPath "$($CertFileName).cer"

# Generate password if not provided
if ($null -eq $CertPassword) {
    Write-Warning "No certificate password provided. A random password will be generated and displayed. Please save it securely."
    $randomPassword = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 16 | ForEach-Object {[char]$_}) + "!A1"
    $CertPassword = ConvertTo-SecureString $randomPassword -AsPlainText -Force
    Write-Host "Generated PFX Password: $randomPassword"
}

Write-Host "Generating self-signed certificate for CN: $CommonName"
Write-Host "DNS Names: $($DnsName -join ', ')"
Write-Host "Validity (Days): $ValidityDays"

# Generate the certificate
try {
    $cert = New-SelfSignedCertificate -Subject "CN=$CommonName" `
        -DnsName $DnsName `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -KeySpec Signature `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddDays($ValidityDays) `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.1") ` # Server Authentication EKU
        -ErrorAction Stop

    Write-Host "Certificate generated successfully. Thumbprint: $($cert.Thumbprint)"

    # Export the certificate to .cer (public key only)
    Write-Host "Exporting public key to: $fullCertPathCer"
    Export-Certificate -Cert $cert -FilePath $fullCertPathCer -ErrorAction Stop
    Write-Host "Public key exported successfully."

    # Export the certificate to .pfx (private key included)
    Write-Host "Exporting certificate with private key to: $fullCertPathPfx"
    Export-PfxCertificate -Cert $cert -FilePath $fullCertPathPfx -Password $CertPassword -ErrorAction Stop
    Write-Host "PFX certificate exported successfully to $fullCertPathPfx"

    if (-not $InstallToUserStore) {
        Write-Host "Removing certificate from CurrentUser store as -InstallToUserStore was false or not specified."
        Remove-Item -Path $cert.PSPath -ErrorAction SilentlyContinue
    } else {
        Write-Host "Certificate remains in CurrentUser\My store as requested."
    }

}
catch {
    Write-Error "Certificate generation failed: $($_.Exception.Message)"
    exit 1
}

Write-Host "Certificate generation script execution completed."
