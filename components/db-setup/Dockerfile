FROM lms-base_node AS base

USER ubuntu
WORKDIR /home/ubuntu/app

# dependencies
COPY --chown=ubuntu db-setup/package.json ./
RUN npm install

FROM base AS builder

# code
COPY --chown=ubuntu shared/configs configs
COPY --chown=ubuntu shared/database_js shared/database_js
COPY --chown=ubuntu shared/utils_js shared/utils_js
COPY --chown=ubuntu db-setup/sample-domains_N32QW_42_200.csv sample-domains.csv
COPY --chown=ubuntu db-setup/main.js main.js
COPY --chown=ubuntu db-setup/entrypoint.sh entrypoint.sh

RUN chmod +x entrypoint.sh

# RUN ["./entrypoint.sh"]
ENTRYPOINT ["/home/ubuntu/app/entrypoint.sh"]