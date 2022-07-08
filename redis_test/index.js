//require을 통해 node_modules에 있는 express를 가져올 수 있다.
const express = require("express");

//express의 반환값을 저장한다.
const app = express();

const redis = require('redis');
const { createCluster }= require('redis');

//const redis_client = redis.createClient(6379,'redis-test.i187of.ng.0001.use1.cache.amazonaws.com');
// Redis

const client = createCluster({
  rootNodes: [
    {
      url: 'redis://redis-test.i187of.ng.0001.use1.cache.amazonaws.com:6379'
    }
  ]
});

client.on("error", (err) => {
  console.error(err);
});

client.on("connect", function () {
  console.log("connected");
});

//check the functioning
client.set("framework", "AngularJS", function (err, reply) {
  console.log("redis.set " , reply);
});

client.get("framework", function (err, reply) {
  console.log("redis.get ", reply);
});



//3000번 포트로 서버를 오픈한다.
//app.listen(3000, () => {
  //console.log("Sever On");
//})