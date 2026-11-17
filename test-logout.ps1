$base = "http://localhost:3000"
$login = @{ email = "aminataingreen@gmail.com"; password = "mot de passe" } | ConvertTo-Json

# 1. Connexion : on récupère les deux tokens
$r = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body $login
$access = $r.accessToken
Write-Host "1. Connexion OK"

# 2. Avant la déconnexion : /auth/me avec l'access token
$me = Invoke-RestMethod -Uri "$base/auth/me" -Headers @{ Authorization = "Bearer $access" }
Write-Host "2. Avant logout : /auth/me -> 200 ($($me.user.email))"

# 3. Déconnexion
$body = @{ refreshToken = $r.refreshToken } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/auth/logout" -Method Post -ContentType "application/json" -Body $body | Out-Null
Write-Host "3. Logout effectué (204)"

# 4. Après la déconnexion : on réutilise l'ANCIEN access token
try {
    $me = Invoke-RestMethod -Uri "$base/auth/me" -Headers @{ Authorization = "Bearer $access" }
    Write-Host "4. Après logout : /auth/me -> 200 ($($me.user.email))  ==> VULNÉRABLE" -ForegroundColor Red
} catch {
    Write-Host "4. Après logout : /auth/me -> $($_.Exception.Response.StatusCode.value__)  ==> CORRIGÉ" -ForegroundColor Green
}