# Daoxin deployment

Target: Linux ECS with Node.js 20+ and Nginx.

1. Upload the project to `/opt/daoxin`.
2. Copy `.env.production.example` to `/opt/daoxin/.env` and fill the real values.
3. Install and start the service:

```sh
sudo cp /opt/daoxin/daoxin.service /etc/systemd/system/daoxin.service
sudo systemctl daemon-reload
sudo systemctl enable --now daoxin
```

4. Install Nginx reverse proxy:

```sh
sudo cp /opt/daoxin/nginx-daoxin.conf /etc/nginx/conf.d/daoxin.conf
sudo nginx -t
sudo systemctl reload nginx
```

5. Verify:

```sh
curl http://127.0.0.1:4188/api/health
curl http://SERVER_PUBLIC_IP/api/health
```
