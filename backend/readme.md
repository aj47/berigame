# Serverless backend for berigame

### useful commands
``` npm install ```
``` npm install serverless -g ```
``` serverless deploy ```

## Service Information
```
service: chatchatbox-api                                                                     
stage: dev                                                                                   
region: ap-southeast-2                                                                       
stack: chatchatbox-api-dev                                                                   
resources: 80                                                                                
endpoints:
  GET - https://k7vwap4vfc.execute-api.ap-southeast-2.amazonaws.com/dev/hello
  POST - https://k7vwap4vfc.execute-api.ap-southeast-2.amazonaws.com/dev/signup
  POST - https://k7vwap4vfc.execute-api.ap-southeast-2.amazonaws.com/dev/login
  POST - https://k7vwap4vfc.execute-api.ap-southeast-2.amazonaws.com/dev/auth
  wss://r5ou09euoa.execute-api.ap-southeast-2.amazonaws.com/dev
functions:
  hello: npc-sim-api-dev-hello (30 MB)
  signup: berigame-api-dev-signup (30 MB)
  login: berigame-api-dev-login (30 MB)
  auth: berigame-api-dev-auth (30 MB)
  connectionHandler: berigame-api-dev-connectionHandler (30 MB)
```

# Known Issues
some issues with serverless-offline and node versions, seems to work with node `16.17`

issue deploying fix:

Upgraded Node to 16.18.0
Upgraded serverless to latest
Uninstalled all packages
Deleted node_modules and yarn.lock
Reinstalled the latest version of all of them
Opened up node_modules/serverless/bin/serverless.js, and right after use strict;, added require('graceful-fs').gracefulify(require('fs'));
Ran my serverless commands in CMD instead of Git Bash