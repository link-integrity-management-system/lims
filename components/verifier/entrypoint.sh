#!/bin/bash

# debugging
# tail -f /dev/null

node src/start_verify_worker.js

# ln -s node_modules/pm2/bin/pm2 pm2
# echo "hi"
# ./pm2 start configs/pm2/collector.config.js
# tail -f ~/.pm2/logs/Collector-out-0.log