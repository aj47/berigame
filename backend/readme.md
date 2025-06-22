# Serverless backend for berigame

### useful commands
``` npm install ```
``` npm install serverless -g ```
``` serverless deploy ```

## Service Information
```
API Endpoints:
•  GET - https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev/hello
•  POST - https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev/google-auth
•  POST - https://dm465kqzfi.execute-api.ap-southeast-2.amazonaws.com/dev/auth

WebSocket:
•  wss://w6et9cl8r6.execute-api.ap-southeast-2.amazonaws.com/dev

Lambda Functions:
•  hello, googleAuth, auth, connectionHandler (all deployed successfully)
```

## Authentication
The application now uses Google OAuth for authentication. Users sign in with their Google accounts, and the backend verifies Google ID tokens to create or authenticate users.

# Known Issues
some issues with serverless-offline and node versions, seems to work with node `16.17`