# Serverless backend for sub2me

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
api keys:                                                                                    
  None                                                                                       
endpoints:                                                                                   
  GET - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/hello                
  POST - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/signup              
  POST - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/login               
  POST - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/auth                
  POST - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/createChatRoom      
  GET - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/getChatRooms         
  POST - https://rmwrulu837.execute-api.ap-southeast-2.amazonaws.com/dev/openChatRoom        
  wss://ahftzn2xw8.execute-api.ap-southeast-2.amazonaws.com/dev                              
functions:                                                                                   
  hello: chatchatbox-api-dev-hello                                                           
  signup: chatchatbox-api-dev-signup                                                         
  login: chatchatbox-api-dev-login                                                           
  auth: chatchatbox-api-dev-auth                                                             
  connectionHandler: chatchatbox-api-dev-connectionHandler                                   
  createChatRoom: chatchatbox-api-dev-createChatRoom                                         
  getChatRooms: chatchatbox-api-dev-getChatRooms                                             
  openChatRoom: chatchatbox-api-dev-openChatRoom                                             
layers:                                                                                      
  None                                                                                       
```
