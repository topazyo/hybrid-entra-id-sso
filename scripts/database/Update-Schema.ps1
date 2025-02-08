[CmdletBinding()]
param (
    [Parameter(Mandatory=$true)]
    [string]$ServerName,
    
    [Parameter(Mandatory=$true)]
    [string]$DatabaseName,
    
    [Parameter(Mandatory=$true)]
    [string]$MigrationPath
)

class DatabaseMigrator {
    [string]$ServerName
    [string]$DatabaseName
    [string]$MigrationPath
    hidden [object]$Logger
    hidden [System.Data.SqlClient.SqlConnection]$Connection

    DatabaseMigrator([string]$server, [string]$database, [string]$migrationPath) {
        $this.ServerName = $server
        $this.DatabaseName = $database
        $this.MigrationPath = $migrationPath
        $this.InitializeLogger()
    }

    [void]InitializeLogger() {
        $logPath = Join-Path $PSScriptRoot "logs"
        if (-not (Test-Path $logPath)) {
            New-Item -ItemType Directory -Path $logPath
        }
        $this.Logger = @{
            Path = Join-Path $logPath "DatabaseMigration.log"
            Write = {
                param($message, $level = "INFO")
                $logMessage = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')|$level|$message"
                Add-Content -Path $this.Path -Value $logMessage
            }
        }
    }

    [void]Connect() {
        $connectionString = "Server=$($this.ServerName);Database=$($this.DatabaseName);Integrated Security=True;"
        $this.Connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
        $this.Connection.Open()
    }

    [void]RunMigrations() {
        try {
            $this.Connect()
            $this.EnsureMigrationHistoryTable()

            $migrations = Get-ChildItem -Path $this.MigrationPath -Filter "*.sql" | 
                Sort-Object Name

            foreach ($migration in $migrations) {
                if (-not $this.IsMigrationApplied($migration.Name)) {
                    $this.ApplyMigration($migration)
                }
            }
        }
        catch {
            $this.Logger.Write.Invoke("Migration failed: $_", "ERROR")
            throw
        }
        finally {
            if ($this.Connection) {
                $this.Connection.Close()
            }
        }
    }

    [void]EnsureMigrationHistoryTable() {
        $sql = @"
            IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[__MigrationHistory]') AND type in (N'U'))
            BEGIN
                CREATE TABLE [dbo].[__MigrationHistory](
                    [MigrationId] [nvarchar](150) NOT NULL,
                    [AppliedOn] [datetime] NOT NULL,
                    CONSTRAINT [PK___MigrationHistory] PRIMARY KEY CLUSTERED ([MigrationId] ASC)
                )
            END
"@
        $command = $this.Connection.CreateCommand()
        $command.CommandText = $sql
        $command.ExecuteNonQuery()
    }

    [bool]IsMigrationApplied([string]$migrationId) {
        $command = $this.Connection.CreateCommand()
        $command.CommandText = "SELECT COUNT(*) FROM [dbo].[__MigrationHistory] WHERE [MigrationId] = @MigrationId"
        $command.Parameters.AddWithValue("@MigrationId", $migrationId)
        return ($command.ExecuteScalar() -gt 0)
    }

    [void]ApplyMigration($migration) {
        $sql = Get-Content $migration.FullName -Raw
        $command = $this.Connection.CreateCommand()
        $command.CommandText = $sql
        
        $transaction = $this.Connection.BeginTransaction()
        $command.Transaction = $transaction

        try {
            $command.ExecuteNonQuery()
            
            $recordCommand = $this.Connection.CreateCommand()
            $recordCommand.Transaction = $transaction
            $recordCommand.CommandText = "INSERT INTO [dbo].[__MigrationHistory] ([MigrationId], [AppliedOn]) VALUES (@MigrationId, @AppliedOn)"
            $recordCommand.Parameters.AddWithValue("@MigrationId", $migration.Name)
            $recordCommand.Parameters.AddWithValue("@AppliedOn", [DateTime]::UtcNow)
            $recordCommand.ExecuteNonQuery()

            $transaction.Commit()
            $this.Logger.Write.Invoke("Applied migration: $($migration.Name)")
        }
        catch {
            $transaction.Rollback()
            throw
        }
    }
}

# Main execution
try {
    $migrator = [DatabaseMigrator]::new($ServerName, $DatabaseName, $MigrationPath)
    $migrator.RunMigrations()
}
catch {
    Write-Error "Database migration failed: $_"
    exit 1
}