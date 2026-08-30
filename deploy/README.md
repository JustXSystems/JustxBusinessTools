# Deploy (retired toolkit)

The large bash deploy framework was replaced by a simpler industry-standard flow:

**→ [`docs/DEPLOY.md`](../docs/DEPLOY.md)** — one-time VPS setup + GitHub Actions + PM2  
**→ [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)** — CI/CD  
**→ [`../scripts/vps-deploy.sh`](../scripts/vps-deploy.sh)** — remote update script  
**→ [`nginx-jbt.conf.example`](nginx-jbt.conf.example)** — nginx `/jbt` locations  

Do not use the old `deploy.sh` / `setup-server.sh` flow.
