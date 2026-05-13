docker buildx build --platform linux/arm64 --load -t verekia/jsblender .
docker save verekia/jsblender | gzip > /tmp/jsblender.tar.gz
scp /tmp/jsblender.tar.gz midgar:/tmp/
ssh midgar docker load --input /tmp/jsblender.tar.gz
ssh midgar docker compose up -d jsblender
