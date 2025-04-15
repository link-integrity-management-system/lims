FROM lms-base_node AS base

USER ubuntu
WORKDIR /home/ubuntu/app

# dependencies
COPY --chown=ubuntu api/package.json ./
RUN npm install

FROM base AS builder

# code
COPY --chown=ubuntu shared/configs configs
COPY --chown=ubuntu shared/database_js shared/database_js
COPY --chown=ubuntu shared/utils_js shared/utils_js
COPY --chown=ubuntu api/src src
COPY --chown=ubuntu api/entrypoint.sh entrypoint.sh

RUN chmod +x entrypoint.sh

# RUN ["./entrypoint.sh"]
ENTRYPOINT ["/home/ubuntu/app/entrypoint.sh"]