$ErrorActionPreference = "Stop"

$url = "https://hievmwwctjjlhmssoxsu.supabase.co"
$fileUrl = "$url/storage/v1/object/public/chorister-profiles/abdurrahim_pekacar.webp"

try {
    $response = Invoke-WebRequest -Uri $fileUrl -Method Head
    Write-Output "Status: $($response.StatusCode)"
} catch {
    Write-Output "Failed to find the file at $fileUrl"
    Write-Output $_.Exception.Response.StatusCode.value__
}
