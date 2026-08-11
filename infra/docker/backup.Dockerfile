# syntax=docker/dockerfile:1.7
FROM postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15

COPY --chmod=0555 infra/scripts/backup.sh /usr/local/bin/backup.sh
RUN sed -i 's/\r$//' /usr/local/bin/backup.sh
RUN mkdir /backups && chown 1000:1000 /backups
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/backup.sh"]
