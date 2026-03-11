-- Add goal description column for existing databases
USE DHAtlas;
GO

IF COL_LENGTH('Goals', 'description') IS NULL
BEGIN
    ALTER TABLE Goals ADD description NVARCHAR(MAX) NULL;
END
GO

PRINT 'Goal description migration completed successfully.';
GO
