FROM lms-base_node AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV PUPPETEER_SKIP_DOWNLOAD=true

# set no-asking
RUN bash -c "echo '* libraries/restart-without-asking boolean true' | debconf-set-selections"

# curl-impersonate dependencies
RUN apt-get install libnss3 nss-plugin-pem ca-certificates

# chrome dependencies
RUN apt-get update
RUN apt-get install -y \ 
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils


RUN apt-get install -y python3-venv

# setup python venv
WORKDIR /home/ubuntu/app
USER ubuntu
RUN python3 -m venv ./venv

ENV PATH="/path/to/venv/bin:$PATH"

# python dependencies
RUN ./venv/bin/pip install esprima

# dependencies
COPY --chown=ubuntu verifier/src/headless-chrome-crawler headless-chrome-crawler
COPY --chown=ubuntu verifier/package.json ./
RUN npm install

# curl-impersonate
RUN mkdir curl-impersonate
RUN wget https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz -O curl-impersonate/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz
RUN tar -xzvf curl-impersonate/curl-impersonate-v0.6.1.x86_64-linux-gnu.tar.gz -C curl-impersonate/

# chrome-for-testing
ARG CHROME_VERSION=128.0.6613.137
RUN mkdir chrome-for-testing
RUN cd chrome-for-testing && npx @puppeteer/browsers install chrome@${CHROME_VERSION}
RUN cd chrome-for-testing && npx @puppeteer/browsers install chromedriver@${CHROME_VERSION}
# RUN ln -s /home/ubuntu/app/chrome-for-testing/chrome/linux-${CHROME_VERSION}/chrome-linux64/chrome /usr/bin/chrome
# RUN ln -s /home/ubuntu/app/chrome-for-testing/chromedriver/linux-${CHROME_VERSION}/chromedriver-linux64/chromedriver /usr/bin/chromedriver

FROM base AS builder

# code
COPY --chown=ubuntu shared/configs configs
COPY --chown=ubuntu shared/database_js shared/database_js
COPY --chown=ubuntu shared/utils_js shared/utils_js

COPY --chown=ubuntu verifier/src src
COPY --chown=ubuntu verifier/entrypoint.sh ./

RUN chmod +x entrypoint.sh

# RUN ["./entrypoint.sh"]
ENTRYPOINT ["/home/ubuntu/app/entrypoint.sh"]