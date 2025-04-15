#!/bin/bash

# debugging
# tail -f /dev/null

debug=${LMS_API_DEBUG:-0}

if [ "$debug" -eq "0" ]; then
    node src/server.js
else
    node --inspect-brk=0.0.0.0 src/server.js
fi