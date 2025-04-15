#!/bin/bash

set -e

# debugging
# tail -f /dev/null

# mitmdump
. /venv/bin/activate
mitmdump -s load_mitm.py --ssl-insecure --set hardump=true