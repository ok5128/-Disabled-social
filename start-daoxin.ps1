$project = "C:\Users\User\OneDrive\文档\daoxin\from-scratch"
$logOut = "$project\daoxin-server.out.log"
$logErr = "$project\daoxin-server.err.log"

Set-Location $project
$env:PORT = "4188"
node server.js 1>> $logOut 2>> $logErr
