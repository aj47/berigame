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
  GET - https://3qzrz2p4f0.execute-api.ap-southeast-2.amazonaws.com/dev/hello
  POST - https://3qzrz2p4f0.execute-api.ap-southeast-2.amazonaws.com/dev/signup
  POST - https://3qzrz2p4f0.execute-api.ap-southeast-2.amazonaws.com/dev/login
  POST - https://3qzrz2p4f0.execute-api.ap-southeast-2.amazonaws.com/dev/auth
  wss://r5ou09euoa.execute-api.ap-southeast-2.amazonaws.com/dev
functions:
  hello: berigame-api-dev-hello (30 MB)
  signup: berigame-api-dev-signup (30 MB)
  login: berigame-api-dev-login (30 MB)
  auth: berigame-api-dev-auth (30 MB)
  connectionHandler: berigame-api-dev-connectionHandler (30 MB)
```
