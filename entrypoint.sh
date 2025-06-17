#!/bin/sh
set -e

# Execute the main command (passed as arguments to this script, i.e., CMD from Dockerfile)
# as the 'nodeuser' user.
exec gosu nodeuser "$@"
