const url = require('url');
const async = require('async');

const { Socket } = require('dgram');
const { stringify } = require('querystring');
const config = require('./configure');

const REDIS_PORT = 6379;
const REDIS_URL = "redis-test.i187of.ng.0001.use1.cache.amazonaws.com"
const Redis = require("ioredis"); 
const redisClient = new Redis(REDIS_PORT, REDIS_URL);

const { RedisSessionStore } = require("./sessionStore");
const sessionStore = new RedisSessionStore(redisClient);

const { redisHashTableStore } = require("./redisHashTableStore");
const hashtableStore = new redisHashTableStore(redisClient);

const { RedisJsonStore } = require("./redisJsonStore");
const jsonStore = new RedisJsonStore(redisClient);

const { redisListStore } = require("./redisListStore");
const listStore = new redisListStore(redisClient);

const { RedisRoomStore, InMemoryRoomStore } = require("./roomStore");
const redis_room = new RedisRoomStore(redisClient);

const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const RoomTotalSchema = require("./schemas/roomTotal/RoomTotalSchema");
const BlackTeam = require("./schemas/roomTotal/BlackTeam");
const WhiteTeam = require("./schemas/roomTotal/WhiteTeam");
const BlackUsers = require("./schemas/roomTotal/BlackUsers");
const UserCompanyStatus = require("./schemas/roomTotal/UserCompanyStatus");
const WhiteUsers = require("./schemas/roomTotal/WhiteUsers");
const Company = require("./schemas/roomTotal/Company");
const Section = require("./schemas/roomTotal/Section");
const Progress = require("./schemas/roomTotal/Progress");

const RoomInfoTotal = require("./schemas/roomTotal/RoomInfoTotal");
const User = require("./schemas/roomTotal/User");
const RoomInfo = require("./schemas/roomTotal/RoomInfo");


String.prototype.replaceAt = function(index, replacement) {
    if (index >= this.length) {
        return this.valueOf();
    }

    return this.substring(0, index) + replacement + this.substring(index + 1);
}

module.exports = (io) => {
    
    var gameserver = io.of("blacknwhite");
 
    var rooms ={};  
    var userPlacement ={}; 
    let Players = [];
    let gamePlayer = {};
    let evenNumPlayer = false;
    let numPlayer = 1;
    let companyNameList = ["companyA", "companyB", "companyC", "companyD", "companyE"];
    let taticNamesList = ["Reconnaissance", "Resource Development", "Initial Access", "Execution", "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement", "Collection", "Command and Control", "Exfiltration", "Impact"];
    let areaNameList = ["DMZ", "Internal", "Security"]

    let timerId;
    let pitaTimerId;

    
    io.use(async (socket, next) => {

        const sessionID = socket.handshake.auth.sessionID;
        const session = await sessionStore.findSession(sessionID);

        if(sessionID){
            socket.sessionID = sessionID;
            socket.userID = session.userID;
            socket.nickname = session.username;
            return next();
        }

        const username = socket.handshake.auth.username;

        if (!username) {
            return next(new Error("invalid username")); 
       
        }

        socket.sessionID = randomId();
        socket.userID = randomId();
        socket.nickname = username;

        next();
    });


    io.on('connection', async(socket) => {
    
        try{
            await sessionStore.saveSession(socket.sessionID, {
                userID: socket.userID,
                username: socket.nickname,
                connected: true,
            }).catch( 
            function (error) {
            console.log('catch handler', error);
            });
    
        }catch(error){
            console.log("ERROR! ", error);
            console.log("connect: saveSession");
           
        }

        console.log("connect: saveSession");
     

        
        socket.on('checkSession', () => {
            var session = { 
                sessionID: socket.sessionID,
                userID: socket.userID,
                nickname: socket.nickname,  
            };
    
            var sessionJSON= JSON.stringify(session);
            socket.emit("sessionInfo", sessionJSON);
        });


        socket.on("isValidRoom", async(room) => {
            var permission = await UpdatePermission(room);
           
            if(permission == 1){
                socket.room = room;
                socket.roomID  = JSON.parse(await redis_room.getRoomInfo(room)).roomID;
            }

            socket.emit('room permission',permission);

        });


        socket.on("randomGameStart", async() => {
            var roomPin, roomID; 
            var publicRoomCnt = await listStore.lenList('publicRoom', 'roomManage');

            if(publicRoomCnt > 0){    
                var publicRoomList = await listStore.rangeList('publicRoom', 0, -1, 'roomManage');

                var randomNum = {};
                randomNum.random = function(n1, n2) {
                    return parseInt(Math.random() * (n2 -n1 +1)) + n1;
                };

                var randomRoomIdx = randomNum.random(0,publicRoomCnt-1);
                var roomPin = publicRoomList[randomRoomIdx];
             
                socket.room = roomPin;
                socket.roomID  = JSON.parse(await redis_room.getRoomInfo(roomPin)).roomID;
              
                socket.emit('enterPublicRoom');

            }else {
                var room_info = await createRoom('public', config.DEFAULT_ROOM.maxPlayer);
            }    
            socket.room = room_info.roomPin;
            socket.roomID = room_info.roomID;
          
            socket.emit('enterPublicRoom');

        });


     
        socket.on("getPublcRooms", async() => {
            var roomslist = await listStore.rangeList('publicRoom', 0, -1, 'roomManage');
            var publicRooms = []

            for (const room of roomslist){
                publicRooms.push({
                    'roomPin' : room.toString(),
                    'userCnt' : (await redis_room.RoomMembers_num(room)).toString(),
                    'maxPlayer' : JSON.parse(await redis_room.getRoomInfo(room)).maxPlayer
                });               
            }   
        
            socket.emit('loadPublicRooms', publicRooms);
        });

      
        socket.on("createRoom", async(room) =>{           
            var room_info= await createRoom(room.roomType, room.maxPlayer);

            socket.room = room_info.roomPin;
            socket.roomID = room_info.roomID;

            socket.emit('succesCreateRoom', {
                roomPin: room_info.roomPin.toString()
            });

        });


        socket.on('add user', async() => {

            io.sockets.emit('Visible AddedSettings'); 
            var room = socket.room;
            var roomManageDict = await hashtableStore.getAllHashTable(room, 'roomManage'); 
        
            var team;
            if (roomManageDict.blackUserCnt > roomManageDict.whiteUserCnt){
                ++roomManageDict.whiteUserCnt ;
                team = true;
            }else {
                ++roomManageDict.blackUserCnt ;
                team = false;
            }
            
            ++roomManageDict.userCnt; 
            
            if (roomManageDict.userCnt >= roomManageDict.maxPlayer){
                var redisroomKey =  roomManageDict.roomType +'Room';
                listStore.delElementList(redisroomKey, 1, room, 'roomManage');
            }


            const rand_Color = roomManageDict.profileColors.indexOf('0'); 
            roomManageDict.profileColors = roomManageDict.profileColors.replaceAt(rand_Color, '1');
         
            await hashtableStore.storeHashTable(room, roomManageDict, 'roomManage'); 
            
            let playerInfo = { userID: socket.userID, nickname: socket.nickname, team: team, status: 0, color: rand_Color, place : await PlaceUser(room, team), socketID : socket.id };
    

            redis_room.addMember(socket.room, socket.userID, playerInfo);
            socket.team = team;
            socket.color = rand_Color;
            socket.join(room);

          
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            var RoomMembersDict = {}

            for (const member of RoomMembersList){
                RoomMembersDict[member] = await redis_room.getMember(room, member);
            }   


            var room_data = { 
                room : room,
                clientUserID : socket.userID,
                maxPlayer : roomManageDict.maxPlayer,
                users : RoomMembersDict
            };
            var roomJson = JSON.stringify(room_data);

            socket.emit('login',roomJson); 
            socket.broadcast.to(room).emit('user joined', JSON.stringify(playerInfo));
        });
        


        socket.on('changeReadyStatus',  async(newStatus) =>{
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            playerInfo.status = newStatus;

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);

            var roomInfo  = await hashtableStore.getHashTableFieldValue(socket.room, ['readyUserCnt', 'maxPlayer'], 'roomManage');
            var readyUserCnt = parseInt(roomInfo[0]);
            var maxPlayer =  parseInt(roomInfo[1]);

            if (newStatus == 1){
                readyUserCnt += 1
            }else {
                readyUserCnt -= 1
            }

            await hashtableStore.updateHashTableField(socket.room, 'readyUserCnt', readyUserCnt, 'roomManage'); 
          
            var playerJson = JSON.stringify(playerInfo);

            io.sockets.in(socket.room).emit('updateUI',playerJson);

          

  
           if(readyUserCnt == maxPlayer){
                io.sockets.in(socket.room).emit('countGameStart');
           }
        });


        socket.on('changeProfileColor',  async() =>{
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
            var prevColorIndex = playerInfo.color;
          
            var profileColors = await hashtableStore.getHashTableFieldValue(socket.room, ['profileColors'], 'roomManage');
            profileColors = profileColors[0].replaceAt(prevColorIndex, '0');
            
            const rand_Color = profileColors.indexOf('0', (prevColorIndex + 1)%12); 
 
            if (rand_Color == -1){
                rand_Color = profileColors.indexOf('0');
            }
            profileColors = profileColors.replaceAt(rand_Color, '1');

            socket.color = rand_Color;
       
            await hashtableStore.updateHashTableField(socket.room, 'profileColors', profileColors, 'roomManage');

         
            playerInfo.color = rand_Color;
   

            await redis_room.updateMember(socket.room, socket.userID, playerInfo);
            var playerJson = JSON.stringify(playerInfo);


            io.sockets.in(socket.room).emit('updateUI',playerJson); 


         
        });  



      
        socket.on('changeTeamStatus',  async(changeStatus) =>{
            var room = socket.room;

         
            var playerInfo = await redis_room.getMember(room, socket.userID);
            playerInfo.status = changeStatus;

            await redis_room.updateMember(room, socket.userID, playerInfo);
            io.sockets.in(socket.room).emit('updateUI',JSON.stringify(playerInfo));


            var prevTeam = playerInfo.team; 
            var prevPlace = playerInfo.place;
          
            if (changeStatus == 0){     
                var myWaitingField, mywaitingList;
                if(prevPlace){
                    myWaitingField = 'toBlackUsers';
                }else{
                    myWaitingField = 'toWhiteUsers';
                }
                var myWaitingData = await hashtableStore.getHashTableFieldValue(room, [myWaitingField], 'roomManage');

                if (myWaitingData[0].length != 0){
                    mywaitingList = myWaitingData[0].split(',');
                    mywaitingList = mywaitingList.filter(function(userID) {
                        return userID != socket.userID;
                    });
            
                    await hashtableStore.updateHashTableField(room, myWaitingField, mywaitingList.join(','), 'roomManage');
                }

               
                var playerJson = JSON.stringify(playerInfo);
                socket.broadcast.to(socket.room).emit('updateUI', playerJson);

            }
           
            else if(changeStatus == 2){
                var roomManageDict = await hashtableStore.getAllHashTable(room, 'roomManage'); 
            


                var limitedUser = parseInt(roomManageDict.maxPlayer / 2);
                if ((prevTeam == true &&  parseInt(roomManageDict.blackUserCnt) < limitedUser) || (prevTeam == false && parseInt(roomManageDict.whiteUserCnt) < limitedUser))
                {                
                    playerInfo.team = !prevTeam;
                    socket.team = !prevTeam;;
                    playerInfo.status = 0; 

                    if(prevTeam){ 
                        -- roomManageDict.whiteUserCnt ; 
                        ++ roomManageDict.blackUserCnt ; 
                    }else{
                      
                        ++ roomManageDict.whiteUserCnt; 
                        -- roomManageDict.blackUserCnt ; 
                    }

                
                    await hashtableStore.storeHashTable(room, roomManageDict, 'roomManage');
  
                    await DeplaceUser(room, prevTeam, prevPlace);
                    playerInfo.place = await PlaceUser(room, !prevTeam);
      
    
                    await redis_room.updateMember(room, socket.userID, playerInfo);


       
                    var changeInfo = { 
                        type : 1,
                        player1 : playerInfo, 
                    };

                    var teamChangeInfo = JSON.stringify(changeInfo);
                    console.log('check : ', teamChangeInfo);
                    io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);
                }else{
                    var othersWaitingField, myWaitingField;
                    if (prevTeam){ 
                        othersWaitingField = 'toWhiteUsers';
                        myWaitingField = 'toBlackUsers';
                    }
                    else{ 
                        othersWaitingField = 'toBlackUsers';
                        myWaitingField = 'toWhiteUsers';
                    }

                    var othersWaitingData = await hashtableStore.getHashTableFieldValue(room, [othersWaitingField], 'roomManage');
                    var myWaitingData = await hashtableStore.getHashTableFieldValue(room, [myWaitingField], 'roomManage');
    
                    var otherswaitingList;
                    var mywaitingList;

                    if (othersWaitingData[0].length != 0){
                        otherswaitingList = othersWaitingData[0].split(',');
                    }else{
                        otherswaitingList = []
                    }

                    if (myWaitingData[0].length != 0){
                        mywaitingList = myWaitingData[0].split(',');
                    } else{
                        mywaitingList = []
                    }
           
                 
     
                    if (otherswaitingList.length == 0){
                        mywaitingList.push(socket.userID);
                        await hashtableStore.updateHashTableField(room, myWaitingField, mywaitingList.join(','), 'roomManage');
                       
                    }else{  
                        var mateUserID = otherswaitingList.shift();
                        await hashtableStore.updateHashTableField(room, othersWaitingField, otherswaitingList.join(','), 'roomManage');
                        var matePlayerInfo = await redis_room.getMember(room, mateUserID);
                        var tmp_place = playerInfo.place;

                        playerInfo.place = matePlayerInfo.place;
                        playerInfo.team = !playerInfo.team ;
                        playerInfo.status = 0;
                        socket.team = playerInfo.team;

                        matePlayerInfo.place = tmp_place;
                        matePlayerInfo.team = !matePlayerInfo.team ;
                        matePlayerInfo.status = 0;

                        await redis_room.updateMember(room, socket.userID, playerInfo);
                        await redis_room.updateMember(room, mateUserID, matePlayerInfo);

                        var changeInfo = { 
                            type : 2,
                            player1 : playerInfo, 
                            player2 : matePlayerInfo
                        };

                        var teamChangeInfo = JSON.stringify(changeInfo);
                        io.sockets.in(socket.room).emit('updateTeamChange',teamChangeInfo);
                        io.to(matePlayerInfo.socketID).emit('onTeamChangeType2');

                    }

                }
            }
        });  

        socket.on('updateSocketTeam',async()=> {
            socket.team = !socket.team;
            var playerInfo = await redis_room.getMember(socket.room, socket.userID);
        });

     
        socket.on('leaveRoom', async()=> {
            console.log(">>>>> [leaveRoom]!");

            var roomPin = socket.room;
         
            await leaveRoom(socket, roomPin);
        });


     
        socket.on('Game Start',  async() =>{
            var blackUsersInfo = []; 
            var whiteUsersInfo = [];
            let infoJson = {};
            
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            for (const member of RoomMembersList){
                var playerInfo = await redis_room.getMember(socket.room, member);
                if (playerInfo.team == false) {
                    infoJson = {UsersID : playerInfo.userID, UsersProfileColor : playerInfo.color}
                    blackUsersInfo.push(infoJson);
                }
                else {
                    infoJson = {UsersID : playerInfo.userID, UsersProfileColor : playerInfo.color}
                    whiteUsersInfo.push(infoJson);
                }
            }

            var roomTotalJson = InitGame(socket.room, blackUsersInfo, whiteUsersInfo);
            var monitoringLog = [];
            jsonStore.storejson(monitoringLog, socket.room+":blackLog");
            jsonStore.storejson(monitoringLog, socket.room+":whiteLog");
       
            jsonStore.storejson(roomTotalJson, socket.room);

            io.sockets.in(socket.room).emit('onGameStart'); 
        });

      
        socket.on('joinTeam', async() => {

            socket.roomTeam = socket.room + socket.team.toString();
            socket.join(socket.roomTeam);

            socket.emit('loadMainGame', socket.team.toString()); //ver3
        });


    
        socket.on('InitGame',  async() =>{
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("On Main Map roomTotalJson : ", roomTotalJson);

            let abandonStatusList = [];
            for(let company of companyNameList){
                abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
            }

            var pitaNum;
            let teamProfileJson = {}
            let userId = []
            if (socket.team == true){
                pitaNum = roomTotalJson[0]["whiteTeam"]["total_pita"];
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamProfileJson[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["profileColor"];
                    userId.push(userID);
                }

            } else {
                pitaNum = roomTotalJson[0]["blackTeam"]["total_pita"];
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamProfileJson[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["profileColor"];
                    userId.push(userID);
                }
            }


            var room_data = { 
                teamName : socket.team,
                teamProfileColor : teamProfileJson,
                userID : userId,
                teamNum : userId.length
            };
            var roomJson = JSON.stringify(room_data);


            socket.emit('MainGameStart', roomJson);
            socket.emit('Load Pita Num', pitaNum);
            
     
            io.sockets.in(socket.room).emit('Company Status', abandonStatusList);

            socket.emit('Visible LimitedTime', socket.team.toString()); // actionbar

          
            var time = 600; 
            var min = "";
            var sec = "";

    
            io.sockets.in(socket.room).emit('Timer START');
            timerId = setInterval(async function(){
                min = parseInt(time/60);
                sec = time%60;
             
                time--;
                if(time<=0) {
                    io.sockets.in(socket.room).emit('Timer END');
                    clearInterval(timerId);
                    clearInterval(pitaTimerId);

                    let roomTotalJsonFinal = JSON.parse(await jsonStore.getjson(socket.room));
                    io.sockets.in(socket.room).emit('Load_ResultPage');
                    socket.on('Finish_Load_ResultPage', ()=> { TimeOverGameOver(socket, roomTotalJsonFinal); });               
                    
                }
            }, 1000);


            var pitaInterval= config.BLACK_INCOME.time * 1000; 
            pitaTimerId = setInterval(async function(){
                const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

                roomTotalJson[0].blackTeam.total_pita += config.BLACK_INCOME.pita;
                roomTotalJson[0].whiteTeam.total_pita += config.WHITE_INCOME.pita;

                var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
                var white_total_pita = roomTotalJson[0].whiteTeam.total_pita;

                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                
                io.sockets.in(socket.room+'false').emit('Update Pita', black_total_pita);
                io.sockets.in(socket.room+'true').emit('Update Pita', white_total_pita);
    
            }, pitaInterval);


        });
        
 
        socket.on('GetScenarioLv',  async function() {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var scenarioLvList = Object.values(roomTotalJson[0]["blackTeam"]["scenarioLevel"]);
            socket.emit('BroadScenarioLv', scenarioLvList);
        });


        
         socket.on('TryUpgradeScenario',  async function(selectedScenario) {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
            var scenarioLvList = Object.values(roomTotalJson[0]["blackTeam"]["scenarioLevel"]);
            var scenarioLv = scenarioLvList[selectedScenario];


            if (scenarioLv >= 5){
                socket.emit('ResultUpgradeScenario', false);
                return;
            }

          
            if (parseInt(black_total_pita) - parseInt(config.UPGRADE_SCENARIO.pita[scenarioLv]) < 0){
                socket.emit('ResultUpgradeScenario', false);
                return;
            };

            scenarioLvList[selectedScenario] += 1
            roomTotalJson[0]["blackTeam"]["scenarioLevel"] = scenarioLvList;
            roomTotalJson[0].blackTeam.total_pita = parseInt(roomTotalJson[0].blackTeam.total_pita) - parseInt(config.UPGRADE_SCENARIO.pita[scenarioLv]);
            await jsonStore.updatejson(roomTotalJson[0], socket.room);

            io.sockets.in(socket.room+'false').emit('Update Pita', roomTotalJson[0].blackTeam.total_pita );
            socket.emit('ResultUpgradeScenario', true);
            io.sockets.in(socket.room).emit('BroadScenarioLv', scenarioLvList);
        });

       
         socket.on('TryBuyScenario',  async function(selectedScenario) {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var black_total_pita = roomTotalJson[0].blackTeam.total_pita;
           
            var scenarioLvList = Object.values(roomTotalJson[0]["blackTeam"]["scenarioLevel"]);
            var scenarioLv = scenarioLvList[selectedScenario];

         
            if (scenarioLv != -1){
                socket.emit('ResultBuyScenario', false);
                return;
            }

         
            if (parseInt(black_total_pita) - parseInt(config.BUY_SCENARIO.pita[selectedScenario]) < 0){
                socket.emit('ResultBuyScenario', false);
                return;
            };

        
            scenarioLvList[selectedScenario] += 1
            roomTotalJson[0]["blackTeam"]["scenarioLevel"] = scenarioLvList;
            roomTotalJson[0].blackTeam.total_pita = parseInt(roomTotalJson[0].blackTeam.total_pita) - parseInt(config.UPGRADE_SCENARIO.pita[scenarioLv]);
            await jsonStore.updatejson(roomTotalJson[0], socket.room);

            io.sockets.in(socket.room+'false').emit('Update Pita', roomTotalJson[0].blackTeam.total_pita );
            socket.emit('ResultBuyScenario', true);
            io.sockets.in(socket.room).emit('BroadScenarioLv', scenarioLvList);
            
        });


      
        socket.on('GetSectAttScenario',  async function(data) {
            var scenarioLv = 0;
            var scenarioNum = data.scenario + 1;
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            
           
            var scenarioLvList = Object.values(roomTotalJson[0]["blackTeam"]["scenarioLevel"]);

            if (data.scenario != -1){
              
                scenarioLv = scenarioLvList[data.scenario];
               
                var sectScenarioHint = { 
                    selectScenario : data.scenario,
                    scenarioLv : scenarioLv
                };

                var attackHint = []; 
                var progressAtt = [];

         
                var sectionAttProgSenario = roomTotalJson[0][data.company].sections[data.section].attackSenarioProgress[data.scenario];
                sectionAttProgSenario.forEach((value, index, array) => {
                    console.log(`${index} :  ${value.attackName}`); 
                    if(value.state==2){
                        var attIdx = config.ATTACK_CATEGORY_DICT[value.tactic];
                        progressAtt.push    ({'attIdx' : attIdx, 'attack' : value.attackName});
                    }
                });

                sectScenarioHint['progressAtt'] = progressAtt;
          

                if (scenarioLv == 1){ 
                    for(let i = 0; i <= 13; i++){
                        if(Object.values(config["SCENARIO" +scenarioNum].attacks[i]).length == 0){
                            attackHint[i] =  false;
                        }else{
                            attackHint[i] =  true;
                        }
                    }
                    sectScenarioHint['isAttacks'] = attackHint;
                }

                if(scenarioLv >= 2){ 
                    for(let i = 0; i <= 13; i++){
                        attackHint[i] =  Object.values(config["SCENARIO" +scenarioNum].attacks[i]).length;
                    }

                    sectScenarioHint['attacksCnt'] = attackHint;
                }


                if(scenarioLv >= 4){ 
                    sectScenarioHint['attacks']=  config["SCENARIO" +scenarioNum].attacks;
                    sectScenarioHint['attackConn'] = config["SCENARIO" +scenarioNum].attackConn;
                }

                if(scenarioLv >= 5){                 
                    sectScenarioHint['mainAttack'] = config["SCENARIO" +scenarioNum].mainAttack;
                }
            }

          
            let sectScenarioHintJson = JSON.stringify(sectScenarioHint);
            console.log('sectionScenarioJson', sectScenarioHintJson);

            socket.emit('SendSectAttScenario', sectScenarioHintJson);
        });
      

      
        socket.on('GetConnectedAtt',  async function(data) {
            console.log("[On] OnGetConnectedAtt ", data.section, data.company, data.scenario, data.attack);

            var scenarioLv = 0;
            var scenarioNum = data.scenario + 1;
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var scenarioLvList = Object.values(roomTotalJson[0]["blackTeam"]["scenarioLevel"]);

            scenarioLv = scenarioLvList[data.scenario];
            console.log("!-- scenarioLv : ", scenarioLvList[data.scenario]);

          
            if(scenarioLv <= 2) return; 

           
            if(scenarioLv == 3){
                var isAttacked = false;
                
                var sectionAttProgSenario = Object.values(roomTotalJson[0][data.company].sections[data.section].attackConn[0]);
                console.log("sectionAttProgSenario :", sectionAttProgSenario);

                var attackParents = [];
                attackParents = config["SCENARIO" +scenarioNum].attackConnParent[data.attack];

                console.log("attackParents :", attackParents);

                for (const attParent in attackParents) {
                    if (sectionAttProgSenario[attParent][data.attack] == true){
                        isAttacked = true;
                        break;
                    }
                    
                }

                if (isAttacked == false){
                    return;
                }
            } 


            var connectedAttHint = {};
            connectedAttHint['attack'] = data.attack;
            connectedAttHint['connection'] = config["SCENARIO" +scenarioNum].attackConnDetail[data.attack];
            let connectedAttJson = JSON.stringify(connectedAttHint);
            console.log("!-- connectedAttJson : ", connectedAttJson);
            socket.emit('SendConnectedAtt', connectedAttJson);
        });


        
         socket.on('GetScenario',  async function(data) {
            var scenarioLv = 0;
            var scenarioNum = data.scenario + 1;
        
            var scenarioHint = { 
                selectScenario : data.scenario,
            };

            var attackHint = []; 
            var progressAtt = [];

            for(let i = 0; i <= 13; i++){
                attackHint[i] =  Object.values(config["SCENARIO" +scenarioNum].attacks[i]).length;
            }
            scenarioHint['attacksCnt'] = attackHint;
    
            
            scenarioHint['attacks']=  config["SCENARIO" +scenarioNum].attacks;
            scenarioHint['attackConn'] = config["SCENARIO" +scenarioNum].attackConn;
            scenarioHint['mainAttack'] = config["SCENARIO" +scenarioNum].mainAttack;
               
        
            let scenarioHintJson = JSON.stringify(scenarioHint);

            socket.emit('SendScenario', scenarioHintJson);
        });

      
         socket.on('GetConnectedAttAll',  async function(data) {
            var scenarioNum = data.scenario + 1;

         
            var connectedAttHint = {};
            connectedAttHint['attack'] = data.attack;
            connectedAttHint['connection'] = config["SCENARIO" +scenarioNum].attackConnDetail[data.attack];
            let connectedAttJson = JSON.stringify(connectedAttHint);
            socket.emit('SendConnectedAttAll', connectedAttJson);
        });

    
        socket.on("Select Company", async(CompanyName) => {
            
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Select Company CompanyIndex : ", CompanyName);

            let teamLocations = {};
            let teamLocationsJson = "";

            if (socket.team == true) {
                roomTotalJson[0]["whiteTeam"]["users"][socket.userID]["currentLocation"] = CompanyName;
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["currentLocation"];
                }
                
                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'true').emit("Load User Location", teamLocationsJson);
            } else {
                roomTotalJson[0]["blackTeam"]["users"][socket.userID]["currentLocation"] = CompanyName;
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'false').emit("Load User Location", teamLocationsJson);
            }

            socket.emit("Load User Location", teamLocationsJson);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
        });


        socket.on("Back to MainMap", async() => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            let teamLocations = {};
            let teamLocationsJson = "";

            if (socket.team == true) {
                roomTotalJson[0]["whiteTeam"]["users"][socket.userID]["currentLocation"] = "";
                for (const userID in roomTotalJson[0]["whiteTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["whiteTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'true').emit("Load User Location", teamLocationsJson);
            } else {
                roomTotalJson[0]["blackTeam"]["users"][socket.userID]["currentLocation"] = "";
                for (const userID in roomTotalJson[0]["blackTeam"]["users"]){
                    teamLocations[userID] = roomTotalJson[0]["blackTeam"]["users"][userID]["currentLocation"];
                }

                teamLocationsJson = JSON.stringify(teamLocations);
                console.log("teamLocationsJson : ", teamLocationsJson);
                socket.to(socket.room+'false').emit("Load User Location", teamLocationsJson);
            }
            
            socket.emit("Load User Location", teamLocationsJson);

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        });

        socket.on("Section Activation Check", async(companyName) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            
            var activationList = [];

            if (socket.team == true){
                for (let i = 0; i <roomTotalJson[0][companyName]["sections"].length; i++){
                    console.log("[socketon - Section Activation Check] roomTotalJson[0][companyName]['sections'][i] : ", roomTotalJson[0][companyName]["sections"][i]);
                    console.log("[socketon - Section Activation Check] roomTotalJson[0][companyName]['sections'][i]['activation'] : ", roomTotalJson[0][companyName]["sections"][i]["defensible"]);
                    activationList.push(roomTotalJson[0][companyName]["sections"][i]["defensible"]);
                }

            } else {
                for (let i = 0; i <roomTotalJson[0][companyName]["sections"].length; i++){
                    console.log("[socketon - Section Activation Check] roomTotalJson[0][companyName]['sections'][i] : ", roomTotalJson[0][companyName]["sections"][i]);
                    console.log("[socketon - Section Activation Check] roomTotalJson[0][companyName]['sections'][i]['activation'] : ", roomTotalJson[0][companyName]["sections"][i]["attackable"]);
                    activationList.push(roomTotalJson[0][companyName]["sections"][i]["attackable"]);
                }
            }         
    
            console.log("[Section Activation List] activationList : ", activationList);
    
            socket.emit("Section Activation List", companyName, activationList);

        });

        // Load Matrix Tactic
        socket.on('Load Tactic level', async(companyName, section) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("load tactic level - companyName : ", companyName);
            console.log("load tactic level - section : ", section);

            let returnValue;
            if (socket.team == true) {
                returnValue = roomTotalJson[0][companyName]["penetrationTestingLV"];
                var attackable = roomTotalJson[0][companyName].sections[section]["defensible"];
            } else {
                returnValue = roomTotalJson[0][companyName]["attackLV"];
                var attackable = roomTotalJson[0][companyName].sections[section]["attackable"];
            }

            console.log("attackable : ", attackable);

            console.log("laod tactic level return : ", returnValue);

            socket.to(socket.room + socket.team).emit("Get Tactic Level", companyName, attackable, returnValue);
            socket.emit("Get Tactic Level", companyName, attackable, returnValue);
        });

        // Load Matrix Technique
        socket.on('Load Technique', async(companyName, section) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("load technique : ", companyName);
            console.log("team : ", socket.team);

            if (socket.team == true) {
                let techniqueActivation = roomTotalJson[0][companyName]["sections"][section]["defenseActive"];
                let techniqueLevel = roomTotalJson[0][companyName]["sections"][section]["defenseLv"];

                console.log("techniqueActivation : ", techniqueActivation);
                console.log("techniqueLevel : ", techniqueLevel);

                socket.emit("Get Technique", companyName, techniqueActivation, techniqueLevel);
            }
        });


        // Matrix -> Emit Select Technique Num for Tactic Upgrade
        socket.on('Upgrade Tactic', async(companyName, section, attackIndex) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("companyName : ", companyName, ",  attackIndex : ", attackIndex)
            console.log("attackIndex : ", attackIndex);

            let cardLv;
            let pitaNum = 0;
            if (socket.team == true) {
                console.log("white team upgrade attack card");
                cardLv = roomTotalJson[0][companyName]["penetrationTestingLV"][attackIndex];
                if (cardLv < 5) {
                    pitaNum = roomTotalJson[0]['whiteTeam']['total_pita'] - config["DEFENSE_" + (attackIndex + 1)]['pita'][cardLv];
                    roomTotalJson[0]['whiteTeam']['total_pita'] = pitaNum;

                    console.log("[!!!!!] pita num : ", pitaNum);
                }
            } else {
                console.log("black team upgrade attack card");
                cardLv = roomTotalJson[0][companyName]["attackLV"][attackIndex];
                console.log("team total_pita : ", roomTotalJson[0]['blackTeam']['total_pita'], ", config pita : ", config["ATTACK_" + (attackIndex + 1)]['pita'][cardLv]);
                if (cardLv < 5) {
                    pitaNum = roomTotalJson[0]['blackTeam']['total_pita'] - config["ATTACK_" + (attackIndex + 1)]['pita'][cardLv];
                    roomTotalJson[0]['blackTeam']['total_pita'] = pitaNum;
    
                    console.log("[!!!!!] pita num : ", pitaNum);
                }
            }

            if (pitaNum >= 0 && cardLv < 5) {
                socket.to(socket.room + socket.team).emit('Update Pita', pitaNum);
                socket.emit('Update Pita', pitaNum);

                let techniqueBeActivationList = roomTotalJson[0][companyName]["sections"][section]["beActivated"];
                techniqueBeActivationList.length = 0;

                // white team -> 공격을 선택할 수 있도록 함
                // balck team -> tactic 레벨 바로 업그레이드
                if (socket.team == true) {
                    console.log("Get Select Technique Num : ", config.ATTACK_UPGRADE_NUM[cardLv]);
                    socket.emit("Get Select Technique Num", companyName, attackIndex, config.ATTACK_UPGRADE_NUM[cardLv], 0);
                } else {
                    console.log("black team upgrade attack card");
                    roomTotalJson[0][companyName]["attackLV"][attackIndex] += 1;

                    console.log("black team tactic upgrade : ", roomTotalJson[0][companyName]["attackLV"]);

                    var attackable = roomTotalJson[0][companyName].sections[section]["attackable"];

                    socket.to(socket.room + socket.team).emit("Get Tactic Level", companyName, attackable, roomTotalJson[0][companyName]["attackLV"]);
                    socket.emit("Get Tactic Level", companyName, attackable, roomTotalJson[0][companyName]["attackLV"]);
                }

                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            } else {
                console.log("Something Problem!!!")
                console.log("pitanum : ", pitaNum)
                console.log("cardLv : ", cardLv)
                if (pitaNum < 0){
                    console.log("업그레이드 실패!! >> pita 부족");
                    socket.emit("Short of Money");
                } else if (cardLv >= 5){
                    console.log("업그레이드 실패!! >> 만랩 달성");
                    socket.emit("Already Max Level");
                }
            }
        });

        // Select Technique
        socket.on('Select Technique', async(companyName, section, categoryIndex, attackIndex) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Select Technique - companyName : ", companyName);
            console.log("Select Technique - section : ", section);
            console.log("Select Technique - categoryIndex : ", categoryIndex);
            console.log("Select Technique - attackIndex : ", attackIndex);

            let cardLv = roomTotalJson[0][companyName]["penetrationTestingLV"][categoryIndex];
            console.log("cardLV : ", cardLv);
            let techniqueBeActivationList = roomTotalJson[0][companyName]["sections"][section]["beActivated"];
            
            if (techniqueBeActivationList.includes(attackIndex)) {
                console.log("Already Select this Attack : ", attackIndex);
                for(var i = 0; i < techniqueBeActivationList.length; i++){ 
                    if (techniqueBeActivationList[i] === attackIndex) { 
                        techniqueBeActivationList.splice(i, 1); 
                        break;
                    }
                }
            } else {
                techniqueBeActivationList.push(attackIndex);
            }

            
            console.log("techniqueBeActivationList : ", techniqueBeActivationList);

            if (techniqueBeActivationList.length == config.ATTACK_UPGRADE_NUM[cardLv]) {
                // 선택 완료
                // let techniqueActivation = roomTotalJson[0][companyName]["sections"][section]["defenseActive"];
                // let techniqueLevel = roomTotalJson[0][companyName]["sections"][section]["defenseLv"];

                // for(var i = 0; i < techniqueBeActivationList.length; i++){ 
                //     techniqueActivation[categoryIndex][techniqueBeActivationList[i]] = 1;
                // }

                // console.log("techniqueActivation : ", techniqueActivation);
                // console.log("techniqueLevel : ", techniqueLevel);

                // socket.emit("Get Technique", companyName, techniqueActivation, techniqueLevel);

                socket.emit("Complete Select Technique", companyName, categoryIndex);

            } else {
                console.log("cardLv : ", cardLv);
                console.log("config.ATTACK_UPGRADE_NUM[cardLv] : ", config.ATTACK_UPGRADE_NUM[cardLv]);
                console.log("techniqueBeActivationList.length : ", techniqueBeActivationList.length);
                socket.emit("Get Select Technique Num", companyName, categoryIndex, config.ATTACK_UPGRADE_NUM[cardLv], techniqueBeActivationList.length);
            }

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        });

        // Select Technique Complete -> Add Active Technique & Upgrade Tactic Level
        socket.on('Select Technique and Upgrade Tactic', async(companyName, section, categoryIndex) => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Select Technique and Upgrade Tactic - companyName : ", companyName);
            console.log("Select Technique and Upgrade Tactic - section : ", section);
            console.log("Select Technique and Upgrade Tactic - categoryIndex : ", categoryIndex);

            // 선택 완료
            let tacticLevel = roomTotalJson[0][companyName]["penetrationTestingLV"];
            let techniqueBeActivationList = roomTotalJson[0][companyName]["sections"][section]["beActivated"];
            let techniqueActivation = roomTotalJson[0][companyName]["sections"][section]["defenseActive"];
            let techniqueLevel = roomTotalJson[0][companyName]["sections"][section]["defenseLv"];

            // 유니티에서 완료버튼 클릭 시 수정할 것!
            if (socket.team == true) {
                console.log("white team upgrade attack card");
                roomTotalJson[0][companyName]["penetrationTestingLV"][categoryIndex] += 1;
            }

            var alreadyAttackList = [];
            for(var i = 0; i < techniqueBeActivationList.length; i++){ 
                var sectionAttackProgressArr = roomTotalJson[0][companyName].sections[section].attackProgress;
                console.log("sectionAttackProgressArr : ", sectionAttackProgressArr);

                if (techniqueActivation[categoryIndex][techniqueBeActivationList[i]] == 2) {
                    // 0 나중에 시나리오 인덱스로 변경할 것
                    // sectionAttackProgressArr = sectionAttackProgressArr.filter(function(progress){
                    // sectionAttackProgressArr = sectionAttackProgressArr.filter(function(progress){
                    //     return progress.tactic == config.ATTACK_CATEGORY[categoryIndex] && progress.attackName == config.ATTACK_TECHNIQUE[categoryIndex][techniqueBeActivationList[i]];
                    // });
                    console.log("sectionAttackProgressArr : ", sectionAttackProgressArr);
                    console.log("sectionAttackProgressArr.state : ", sectionAttackProgressArr.state);

                    var attackJson = {category : categoryIndex, technique : techniqueBeActivationList[i], cooltime : config["DEFENSE_" + (categoryIndex + 1)]["time"][techniqueLevel[categoryIndex][techniqueBeActivationList[i]]],
                                        state : sectionAttackProgressArr[0].state, level : techniqueLevel[categoryIndex][techniqueBeActivationList[i]]};
                    alreadyAttackList.push(attackJson);
                }

                techniqueActivation[categoryIndex][techniqueBeActivationList[i]] = 1;
            }

            console.log("techniqueActivation : ", techniqueActivation);
            console.log("techniqueLevel : ", techniqueLevel);

            socket.emit("Get Technique", companyName, techniqueActivation, techniqueLevel);
            socket.emit("Get Tactic Level", companyName, tacticLevel);

            // 여러 공격도 처리될 수 있도록 하기
            for (var i = 0; i < alreadyAttackList.length; i++) {
                DefenseCooltime(socket, alreadyAttackList[i].state, companyName, section, alreadyAttackList[i].category, alreadyAttackList[i].technique, alreadyAttackList[i].level);
                socket.emit('Start Defense', companyName, section, alreadyAttackList[i].category, alreadyAttackList[i].technique, alreadyAttackList[i].cooltime);
            }

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        });


        // 회사 몰락 여부 확인
        socket.on('On Main Map', async() => {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("On Main Map roomTotalJson : ", roomTotalJson);

            let abandonStatusList = [];
            for(let company of companyNameList){
                abandonStatusList.push(roomTotalJson[0][company]["abandonStatus"]);
            }

            console.log("On Main Map abandonStatusList : ", abandonStatusList);
            socket.to(socket.room).emit('Company Status', abandonStatusList);
            socket.emit('Company Status', abandonStatusList);
        })
        

        socket.on('On Monitoring', async(companyName) => {
            console.log("On Monitoring companyName : ", companyName);
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            let company_blockedNum = 0;

            for (var userId in roomTotalJson[0]["blackTeam"]["users"]){
                console.log("[On Monitoring] user id : ", userId);
                if (roomTotalJson[0]["blackTeam"]["users"][userId][companyName]["IsBlocked"] == true){
                    company_blockedNum += 1;
                }
            }

            console.log("[On Monitoring] company_blockedNum : ", company_blockedNum);
        
            socket.to(socket.room+'true').emit("Blocked Num", company_blockedNum);
            socket.emit('Blocked Num', company_blockedNum);
        })

        socket.on("Send Chat", async(chat) => {
            console.log("[send chat] chatting : ", chat);

            let now_time = new Date();   
            let hours = now_time.getHours();
            let minutes = now_time.getMinutes();
            let timestamp = hours+":"+minutes;

            console.log("socket.color : ", socket.color);
            console.log("socket.color type : ", typeof(socket.color));

            socket.to(socket.room+socket.team).emit("Update Chat", timestamp, socket.nickname, socket.color, chat);
            socket.emit("Update Chat", timestamp, socket.nickname, socket.color, chat);

            // chattingLogger.error('game:chatting', {
            //     server : server_ip,
            //     userIP : '192.0.0.1',
            //     sessionID : socket.sessionID,
            //     userID : socket.userID,
            //     nickname : socket.nickname,
            //     data : {
            //         roomID : socket.roomID,
            //         room : socket.room,
            //         team : socket.team,
            //         chatting : chat
            //     } 
            // });
        })

        socket.on("Is Abandon Company", async(companyName) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            console.log("Is Abandon Company : ", roomTotalJson[0][companyName].abandonStatus);
            if (roomTotalJson[0][companyName].abandonStatus) {
                socket.to(socket.room).emit('Abandon Company', companyName);
            }
        })

        socket.on('Section_Name_NonUP', async(data) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            data = JSON.parse(data);
            var corpName = data.Corp;
            var sectionIdx = data.areaIdx;

            var area_level = sectionIdx.toString() + "-" + (roomTotalJson[0][corpName].sections[sectionIdx].level);
            io.sockets.in(socket.room+'true').emit('Now_Level', corpName, area_level.toString());
        });

        socket.on('Section_Name', async(data) => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var white_total_pita = roomTotalJson[0].whiteTeam.total_pita;

            data = JSON.parse(data);
            var corpName = data.Corp;
            var sectionIdx = data.areaIdx;
            
            if(white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level] < 0)
            {
                socket.emit("Short of Money");
            } else {
                if(roomTotalJson[0][corpName].sections[sectionIdx].level >= config.MAX_LEVEL)
                {
                    socket.emit("Out of Level");
                } else 
                {
                    var newTotalPita = white_total_pita - config.MAINTENANCE_SECTION_INFO.pita[roomTotalJson[0][corpName].sections[sectionIdx].level]; 
                    roomTotalJson[0].whiteTeam.total_pita = newTotalPita;
                    roomTotalJson[0][corpName].sections[sectionIdx].level += 1;
                    var attackProgressLen = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress.length;
                    newLevel = roomTotalJson[0][corpName].sections[sectionIdx].level;

 
                    newSusCnt = 0
                    switch (newLevel) {
                        case 1: 
                            for (var i=0; i<attackProgressLen; i++){
                                newSusCnt = newSusCnt + (Math.floor(Math.random() * 5) + 1);
                            }
                            break;
                        case 2: 
                            for (var i=0; i<attackProgressLen; i++){
                                newSusCnt = newSusCnt + Math.floor(Math.random() * 3) + 1;
                            }                            
                            break;
                        case 3: 
                            for (var i=0; i<attackProgressLen; i++){
                                newSusCnt = newSusCnt + Math.floor(Math.random() * 4);
                            }                             
                            break;
                        case 4: 
                            for (var i=0; i<attackProgressLen; i++){
                                newSusCnt = newSusCnt + Math.floor(Math.random() * 3);
                            } 
                            break;
                        case 5:
                            newSusCnt = attackProgressLen;
                            break;
                    }
                    roomTotalJson[0][corpName].sections[sectionIdx].suspicionCount = newSusCnt;
                    await jsonStore.updatejson(roomTotalJson[0], socket.room);

                    var area_level = sectionIdx.toString() + "-" + (roomTotalJson[0][corpName].sections[sectionIdx].level);
                    io.sockets.in(socket.room+'true').emit('New_Level', corpName, area_level.toString());
                    io.sockets.in(socket.room+'true').emit('Update Pita', newTotalPita);
                    io.sockets.in(socket.room+'true').emit('Issue_Count_Update', corpName);
                }
            }
        });


        socket.on('Get_Issue_Count', async(corp) => {            
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var corpName = corp;
            var sectionsArr = roomTotalJson[0][corpName].sections;
            var cntArr = [];
            sectionsArr.forEach( async(element, idx) => {
                var sectionData = element.suspicionCount;
                cntArr[idx] = sectionData;
            });
            socket.emit('Issue_Count', cntArr, corpName);
        });


        socket.on('Get_Monitoring_Log', async(corp) => {
            const roomTotalJson_pita = JSON.parse(await jsonStore.getjson(socket.room));
            var white_total_pita = roomTotalJson_pita[0].whiteTeam.total_pita;

            var corpName = corp;
            var areaArray = roomTotalJson_pita[0][corpName].sections;
            var totalSuspicionCount = 0;
            areaArray.forEach(element => {
                totalSuspicionCount += element.suspicionCount;
            });
            var totalCharge = (config.ANLAYZE_PER_ATTACKCNT * totalSuspicionCount);
            
            if(white_total_pita - totalCharge < 0)
            {
                socket.emit("Short of Money");
            } else {
                var newTotalPita = white_total_pita - totalCharge;
                const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                var corpName = corp;
                var sectionsArr = roomTotalJson[0][corpName].sections;
                var logArr = [];
                roomTotalJson[0].whiteTeam.total_pita = newTotalPita;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                sectionsArr.forEach( async(element, idx) => {
                    var sectionLogData = element.attackProgress;
                    sectionLogData.forEach(logElement => {
                        switch (logElement.state) {
                            case 1 :
                                var newLog = {
                                    area: areaNameList[idx],
                                    tactic: logElement.tactic,
                                    attackName: logElement.attackName + " is in progress."
                                }
                                break;
                            case 2 : 
                                var newLog = {
                                    area: areaNameList[idx],
                                    tactic: logElement.tactic,
                                    attackName: logElement.attackName + "has been carried out."
                                }
                                break;
                        }
                        logArr.push(newLog);
                    });                
                });
                io.sockets.in(socket.room+'true').emit('Monitoring_Log', logArr, corpName);
                let today = new Date();   
                let hours = today.getHours(); // 시
                let minutes = today.getMinutes();  // 분
                let seconds = today.getSeconds();  // 초
                let now = hours+":"+minutes+":"+seconds;
                var gameLog = {time: now, nickname: "", targetCompany: corpName, targetSection: "", detail: "Log analysis is complete."};
                var logArr = [];
                logArr.push(gameLog);
                io.sockets.in(socket.room+'true').emit('addLog', logArr);


                sectionsArr.forEach( async(element, sectionIdx) => {
                    var sectionDefenseProgressArr = element.defenseProgress;
                    var sectionDefenseActivationArr = element.defenseActive;
                    var defenseLv = element.defenseLv;

                    var sectionAttackData = element.attackProgress;
                    sectionAttackData.forEach( async(attackElement) => {
                        
                        var tacticIndex = config.ATTACK_CATEGORY.indexOf(attackElement.tactic);
                        var techniqueIndex = config.ATTACK_TECHNIQUE[tacticIndex].indexOf(attackElement.attackName);
                        console.log(attackElement.tactic, tacticIndex, attackElement.attackName, techniqueIndex, sectionDefenseActivationArr[tacticIndex][techniqueIndex]);

                        if (sectionDefenseActivationArr[tacticIndex][techniqueIndex] == 1){
                            var newInfo = { tactic: attackElement.tactic, attackName: attackElement.attackName, state: false }; 
                            sectionDefenseProgressArr[tacticIndex].push(newInfo);
                            DefenseCooltime(socket, newInfo.state, corpName, sectionIdx, tacticIndex, techniqueIndex, defenseLv[tacticIndex][techniqueIndex]);
                            socket.emit('Start Defense', corpName, sectionIdx, tacticIndex, techniqueIndex, config["DEFENSE_" + (tacticIndex + 1)]["time"][defenseLv[tacticIndex][techniqueIndex]]);
                        } else if (sectionDefenseActivationArr[tacticIndex][techniqueIndex] == 0) {
                            sectionDefenseActivationArr[tacticIndex][techniqueIndex] = 2;
                            let techniqueLevel = roomTotalJson[0][corpName]["sections"][sectionIdx]["defenseLv"];
                            socket.emit("Get Technique", corpName, sectionDefenseActivationArr, techniqueLevel);
                        }

                        await jsonStore.updatejson(roomTotalJson[0], socket.room);
                    });
                });

            }
        });
      

       
        socket.on('Get_Final_RoomTotal', async() => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var finalRoomTotal = {
                blackPita : roomTotalJson[0].blackTeam.total_pita,
                whitePita : roomTotalJson[0].whiteTeam.total_pita,
                winHodu : config.WIN_HODU,
                loseHodu : config.LOSE_HODU,
                tieHodu: config.TIE_HODU,
                winTeam : false
            }         

            var blackUsersInfo = []; 
            var whiteUsersInfo = [];
            let infoJson = {};
            
            var RoomMembersList =  await redis_room.RoomMembers(socket.room);
            for (const member of RoomMembersList){
                var playerInfo = await redis_room.getMember(socket.room, member);
                if (playerInfo.team == false) {
                    infoJson = {UsersID : playerInfo.userID, nickname : playerInfo.nickname, UsersProfileColor : playerInfo.color}
                    blackUsersInfo.push(infoJson);
                }
                else {
                    infoJson = {UsersID : playerInfo.userID, nickname : playerInfo.nickname, UsersProfileColor : playerInfo.color}
                    whiteUsersInfo.push(infoJson);
                }
            }

            io.sockets.in(socket.room).emit('playerInfo', blackUsersInfo, whiteUsersInfo, JSON.stringify(finalRoomTotal));
        });

        socket.on('All_abandon_test', async() => {
            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            for(let company of companyNameList){
                roomTotalJson[0][company]["abandonStatus"] = true;
            }
            await jsonStore.updatejson(roomTotalJson[0], socket.room);

            AllAbandon(socket, roomTotalJson);
        });


        socket.on('click_technique_button', async(data, attackName, tacticName) => {
            console.log("wasd >> ", attackName, tacticName);
            if(attackName.includes("\n")) { attackName = attackName.substring(1); }

            const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            data = JSON.parse(data);
            var corpName = data.Corp;
            var sectionIdx = data.areaIdx;
            var tacticIdx = taticNamesList.indexOf(tacticName);
            var attackProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress;
            var attackLv = roomTotalJson[0][corpName].attackLV[tacticIdx];
            var suspicionCount = roomTotalJson[0][corpName].sections[sectionIdx].suspicionCount;
            var areaLv = roomTotalJson[0][corpName].sections[sectionIdx].level;
            var currentPita = roomTotalJson[0].blackTeam.total_pita;

            if (attackLv == 0) {
                socket.emit('Failed to success level');
                return;
            }

            var lvPita = config["ATTACK_" + (tacticIdx + 1)]["pita"][attackLv - 1];
            if (currentPita - lvPita < 0) {
                socket.emit('Short of Money');
                return;
            }

            roomTotalJson[0].blackTeam.total_pita = currentPita - lvPita;

            var lvCoolTime = config["ATTACK_" + (tacticIdx + 1)]["time"][attackLv - 1];

            socket.emit('CoolTime_LV', lvCoolTime, corpName);


            var overlap = false;
            attackProgressArr.forEach(element => {
                if(element.attackName == attackName) {
                    overlap = true;
                    return false;
                }
            });

            if(!overlap) {
                var newInfo = { tactic: tacticName, attackName: attackName, state: 1 }; 
                attackProgressArr.push(newInfo);
                var fakeCnt = 0;
                switch (areaLv) {
                    case 1:
                        fakeCnt = Math.floor(Math.random() * 5) + 1;
                        break;
                    case 2: 
                        fakeCnt = Math.floor(Math.random() * 3) + 1;
                        break;
                    case 3:
                        fakeCnt = Math.floor(Math.random() * 4);
                        break;
                    case 4:
                        fakeCnt = Math.floor(Math.random() * 3);
                        break;
                }
                suspicionCount = (suspicionCount + 1) + fakeCnt;
                roomTotalJson[0][corpName].sections[sectionIdx].suspicionCount = suspicionCount;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);

                io.sockets.in(socket.room+'true').emit('Issue_Count_Update', corpName);
                AttackCoolTime(socket, (lvCoolTime*1000), corpName, sectionIdx, tacticIdx, attackLv, tacticName, attackName); // (socket, corpName, sectionIdx, attackIdx, tacticIdx, attackLv, tacticName, attackName)

            }
        });

        socket.on('disconnect', async function() {
            clearInterval(timerId)
            clearInterval(pitaTimerId);

            
            if (socket.room){
                await leaveRoom(socket, socket.room);
            }
            
            // lobbyLogger.info('mainHome:logout', {
            //     server : server_ip,
            //     userIP : '192.0.0.1',
            //     sessionID : socket.sessionID,
            //     userID : socket.userID,
            //     nickname : socket.nickname,
            //     data : {status : 1} 
            // });

            await sessionStore.deleteSession(socket.sessionID);
        });
    })


    // [room] 방 키 5자리 랜덤 
    function randomN(){
        var randomNum = {};

        //0~9까지의 난수
        randomNum.random = function(n1, n2) {
            return parseInt(Math.random() * (n2 -n1 +1)) + n1;
        };
    
        var value = "";
        for(var i=0; i<5; i++){
            value += randomNum.random(0,9);
        }

        return value;
    };


    // 현재 날짜 문자열 생성
    function nowDate(){
        var today = new Date();
        var year = today.getFullYear();
        var month = ('0' + (today.getMonth() + 1)).slice(-2);
        var day = ('0' + today.getDate()).slice(-2);
        
        var today = new Date();   
        var hours = ('0' + today.getHours()).slice(-2); 
        var minutes = ('0' + today.getMinutes()).slice(-2);
        var seconds = ('0' + today.getSeconds()).slice(-2); 
        
        var dateString = year + '-' + month  + '-' + day;
        var timeString = hours + ':' + minutes  + ':' + seconds;
    
        var now_date = dateString + " " + timeString;
        return now_date;
    }

    // [WaitingRoom] UI player 대응 컴포넌트 idx 할당
    async function PlaceUser(roomPin, team){
        console.log("PlaceUser 함수---!");

        // var roomPin = socket.room;
        var userPlacementName ;

        if(!team){ //false(0)면 black
            userPlacementName =  'blackPlacement';
        }else{
            userPlacementName =  'whitePlacement';
        } 

        console.log("userPlacementName " , userPlacementName);

        var userPlacement =await hashtableStore.getHashTableFieldValue(roomPin, [userPlacementName], 'roomManage');
        console.log("userPlacement " , userPlacement);

        if(!userPlacement)// 널처리
        {
            return -1
        }

        userPlacement = userPlacement[0].split('');
        console.log("userPlacement.split() " , userPlacement);
        var place =  userPlacement.pop();

        var newUserPlacement =  userPlacement.join('');
        console.log("AFTER! userPlacement.join('')" , newUserPlacement);
        await hashtableStore.updateHashTableField(roomPin, userPlacementName, newUserPlacement, 'roomManage');


        console.log("[PlaceUser] 반환 team : ", team, " place : ", place); 
      
        return place
    }

    // [WaitingRoom] UI player 대응 컴포넌트 idx 제거
    async function DeplaceUser(roomPin, prevTeam, idx){
        console.log("DeplaceUser 함수---! return idx : ", idx);

        // var roomPin = socket.room;
        var userPlacementName ;

        if(!prevTeam){ // false(0) 면 black팀
            userPlacementName =  'blackPlacement';
        }else{
            userPlacementName =  'whitePlacement';
        }

        console.log("userPlacementName " , userPlacementName);

        var userPlacement = await hashtableStore.getHashTableFieldValue(roomPin, [userPlacementName], 'roomManage');
        // console.log("userPlacement " , userPlacement);
        userPlacement = userPlacement[0].split('');
        // console.log("userPlacement.split() " , userPlacement);
        userPlacement.push(idx);
        // console.log("$$DeplaceUser  userPlacement : " ,userPlacement);

        userPlacement =  userPlacement.join('');
        console.log("AFTER! userPlacement" , userPlacement);
        console.log("check!! ", await hashtableStore.updateHashTableField(roomPin, userPlacementName, userPlacement, 'roomManage'));
    }

    async function createRoom(roomType, maxPlayer){
        //  1. redis - room에 저장
        var roomPin = randomN();
        var roomID = randomId();
        while (redis_room.checkRooms(roomPin))
        {
            console.log("룸키 중복 발생_룸 키 재발급");
            roomPin = randomN();
        }


        var creationDate = nowDate();

        var room_info = {
            roomID : roomID,
            roomPin : roomPin,
            creationDate : creationDate,
            roomType : roomType,
            maxPlayer : maxPlayer
        };

        await redis_room.createRoom(roomPin, room_info);

        // 2. redis - roomManage/'roomKey' 저장
        var room_info_redis = {
            'roomID' : roomID,
            'roomType' : roomType,
            'creationDate' : creationDate,
            'maxPlayer' : maxPlayer,
            'userCnt' : 0,
            'readyUserCnt' : 0,
            'whiteUserCnt' : 0,
            'blackUserCnt' : 0,
            'blackPlacement' : config.ALLOCATE_PLAYER_UI[maxPlayer],
            'whitePlacement' : config.ALLOCATE_PLAYER_UI[maxPlayer],
            'toBlackUsers' : [],
            'toWhiteUsers' : [],
            'profileColors' : '000000000000'
        };

        hashtableStore.storeHashTable(roomPin, room_info_redis, 'roomManage');

        // 3. redis - roomManage/publicRoom 또는 roomManage/privateRoom 에 저장
        var redisroomKey =  roomType +'Room';
        listStore.rpushList(redisroomKey, roomPin, false, 'roomManage');

        return room_info
    };


    // 공개방/비공개 방 들어갈 수 있는지 확인 (검증 : 룸 존재 여부, 룸 full 여부)
    async function UpdatePermission(roomPin){
         /*
                < 로직 > 
                1. 해당 룸 핀이 있는지 확인
                2. 해당 룸에 들어갈 수 있는지 (full상태 확인)
                3. permission 주기 (socket.room 저장, 방 상태 update 및 cnt ++)
        */

        // 1. 해당 룸 핀이 있는지 확인
        if (! await redis_room.IsValidRoom(roomPin)) { 
            console.log("permission False - no Room");
            return -1
        }

        // 2. 해당 룸에 들어갈 수 있는지 (full상태 확인)
        console.log("room_member 수", await redis_room.RoomMembers_num(roomPin))
        if (await redis_room.RoomMembers_num(roomPin) >= JSON.parse(await redis_room.getRoomInfo(roomPin)).maxPlayer){
            console.log("permission False - room Full");
            return 0
        }

        return 1
    };

    // 팀 교체 함수 (type 1) 
    async function switchTeamType1(socket, playerInfo){


    };

    // 방 나가는  함수
    async function leaveRoom(socket, roomPin){

        // 1. 해당 인원이 나가면 room null인지 확인 (user 0명인 경우 룸 삭제)
        if (await redis_room.RoomMembers_num(roomPin) <= 1){
            console.log("[룸 삭제]!");
            redis_room.deleteRooms(roomPin); // 1) redis 기본 room 삭제

            var redisroomKey = await hashtableStore.getHashTableFieldValue(roomPin, ['roomType'], 'roomManage'); // 3번 과정을 위해 roomType 가져오기
            console.log('redisroomKey : ',redisroomKey, 'roomPin : ', roomPin);
            console.log('hashtableStore.deleteHashTable', hashtableStore.deleteHashTable(roomPin,'roomManage')); // 2) roomManage room 삭제
            console.log('listStore.delElementList : ', listStore.delElementList(redisroomKey[0] + 'Room', 0, roomPin, 'roomManage')); // 3) roomManage list에서 삭제
              
            // 2. 방에 emit하기 (나갈려고 하는 사용자에게 보냄)
            socket.emit('logout'); 

            // 3. 방에 emit하기 (그 외 다른 사용자들에게 나간 사람정보 보냄_
            socket.broadcast.to(roomPin).emit('userLeaved',socket.userID);  
    
            // 4. (join삭제) 
            socket.leave(roomPin);

            // lobbyLogger.info('mainHome:delete_room', {
            //     server : server_ip,
            //     userIP : '192.0.0.1',
            //     sessionID : socket.sessionID,
            //     userID : socket.userID,
            //     nickname : socket.nickname,
            //     data :  {
            //         roomID : socket.roomID,
            //         room : socket.room,
            //     }
            // });
        }
        else{  // 나중에 if에 return 추가해서 else는 없애주기 
            // 1) roomManage room 인원 수정
            // userCnt, blackUserCnt/whiteUserCnt, blackPlacement/whitePlacement, profileColors  수정 필요

            // 주의! DeplaceUser부터 해줘야함
            var userInfo = await redis_room.getMember(socket.room, socket.userID);
            console.log(" userInfo : " ,userInfo, userInfo.place);
            if (socket.team){
                await DeplaceUser(roomPin, socket.team, userInfo.place); // blackPlacement/whitePlacement  -> DeplaceUser
            }else{
                await DeplaceUser(roomPin, socket.team, userInfo.place);  // blackPlacement/whitePlacement  -> DeplaceUser
            }
            
            var roomManageInfo = await hashtableStore.getAllHashTable(roomPin, 'roomManage'); ;
            console.log("[[[ 수정전 ]]] roomManageInfo" , roomManageInfo);


            // userCnt 변경
            roomManageInfo.userCnt = roomManageInfo.userCnt - 1;

            // blackUserCnt/whiteUserCnt 변경
            // toBlackUsers, toWhiteUsers 초기화
            var othersWaitingField, myWaitingField;
            if (socket.team){
                roomManageInfo.whiteUserCnt = roomManageInfo.whiteUserCnt - 1;
                myWaitingField = 'toBlackUsers';
                othersWaitingField = 'toWhiteUsers';
            }else{
                roomManageInfo.blackUserCnt = roomManageInfo.blackUserCnt - 1;
                myWaitingField = 'toWhiteUsers';
                othersWaitingField = 'toBlackUsers';
            }
          
            // 만약 해당 유저가 웨이팅리스트에 있었다면 삭제함
            if(roomManageInfo[myWaitingField].length != 0){
                console.log("나 - 웨이팅 리스트에서 삭제함");
                var mywaitingList = roomManageInfo[myWaitingField].split(',');
                roomManageInfo[myWaitingField] = mywaitingList.filter(function(userID) {
                    return userID != socket.userID;
                });
            }

            // profileColor 변경 
            console.log("socket.color ", socket.color);
            roomManageInfo.profileColors = roomManageInfo.profileColors.replaceAt(socket.color, '0');
            console.log("roomManageInfo.profileColors", roomManageInfo.profileColors);

            // readycnt 변경 
            if(userInfo.status == 1){
                roomManageInfo.readyUserCnt -= 1 ;
            }
        
            console.log("[[[수정 후 ]]] roomManageInfo" , roomManageInfo);
            await hashtableStore.storeHashTable(roomPin, roomManageInfo, 'roomManage');


            // 2)  Redis - room 인원에서 삭제
            redis_room.delMember(roomPin, socket.userID);

            // 2. 방에 emit하기 (나갈려고 하는 사용자에게 보냄)
            socket.emit('logout'); 

            // 3. 방에 emit하기 (그 외 다른 사용자들에게 나간 사람정보 보냄_
            socket.broadcast.to(roomPin).emit('userLeaved',socket.userID);  
    
            // 4. (join삭제) 
            socket.leave(roomPin);

            ////---------------- 후 처리
            // 3) 다른 유저의 teamChange 가능한지 확인 후 정보 저장
            var otherswaitingList;
            if(roomManageInfo[othersWaitingField].length != 0){
                console.log("다른유저 -팀 체인지 진행");
                otherswaitingList = othersWaitingData[0].split(',');

                console.log("otherswaitingList : " , otherswaitingList);

                var mateUserID = otherswaitingList.shift();
                var matePlayerInfo = await redis_room.getMember(room, mateUserID);
                console.log("mate 정보 : " , matePlayerInfo);

                matePlayerInfo.place = userInfo.place;
                matePlayerInfo.team = userInfo.team ;
                matePlayerInfo.status = 0;
                await redis_room.updateMember(room, mateUserID, matePlayerInfo);

                var teamChangeInfo = { 
                    type : 1,
                    player1 : matePlayerInfo
                };
                
                // teamchange 정보 보내기 
                console.log('JSON.stringify(changeInfo); : ', JSON.stringify(changeInfo));
                io.sockets.in(socket.room).emit('updateTeamChange', JSON.stringify(teamChangeInfo));
            }

            // 3) roomManage list 인원 확인 (함수로 따로 빼기)
            // 만약 해당 룸이 full이 아니면 list에 추가해주기
            var redisroomKey =  roomManageInfo.roomType + 'Room';
            var publicRoomList = await listStore.rangeList(redisroomKey, 0, -1, 'roomManage');

            if (!publicRoomList.includes(roomPin) && (await redis_room.RoomMembers_num(roomPin) <= JSON.parse(await redis_room.getRoomInfo(roomPin)).maxPlayer)){
                await listStore.rpushList(redisroomKey, roomPin, false, 'roomManage');
                console.log("roomManage의 list에 추가됨");
            }

        }
        
        // lobbyLogger.info('mainHome:leave_room', {
        //     server : server_ip,
        //     userIP : '192.0.0.1',
        //     sessionID : socket.sessionID,
        //     userID : socket.userID,
        //     nickname : socket.nickname,
        //     data :  {
        //         roomID : socket.roomID,
        //         room : socket.room,
        //     }
        // });
    

        // 5. 나머지 room 관련 정보 socket에서 삭제 및 빈 값으로 수정해주기!!
        socket.room = null;
        socket.roomID = null;
        socket.team = null;
        socket.color = null;
    };


    // [GameStart] 게임시작을 위해 게임 스키마 초기화 
    function InitGame(room_key, blackUsersInfo, whiteUsersInfo){
        console.log("INIT GAME 호출됨------! blackUsersID", blackUsersInfo);


        /*
            var blackUsers = [ user1ID, user2ID, user3ID ];
        */

        // RoomTotalJson 생성 및 return 
        var blackUsers = {};
        var whiteUsers = {};

        for (const user of blackUsersInfo){
            blackUsers[user.UsersID] = new BlackUsers({
                userId   : user.UsersID,
                profileColor : user.UsersProfileColor,
                currentLocation : "",
            });
        }

        for (const user of whiteUsersInfo){
            whiteUsers[user.UsersID] =  new WhiteUsers({
                userId   : user.UsersID,
                profileColor : user.UsersProfileColor,
                currentLocation : ""
            })
        }
    

        var initCompanyArray = []
        for (var i = 0; i < 5; i++){
            var initCompany = new Company({
                abandonStatus : false,
                penetrationTestingLV : [0,0,0,0,0,0,0,0,0,0,0,0,0,0], // 14개 
                attackLV : [0,0,0,0,0,0,0,0,0,0,0,0,0,0],  // 유형레벨 14가지
                sections : [
                    new Section({
                        attackable : true,
                        defensible : true,
                        destroyStatus : true ,
                        level  : 1,
                        suspicionCount : 1,
                        attackProgress : [],
                        attackSenarioProgress  : [[], [], [], [], []],
                        defenseProgress : [[], [], [], [], []],
                        beActivated : [],
                        defenseActive: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 활성화된 방어
                        defenseLv : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 레벨 
                        defenseCnt : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 횟수 
                        attackConn : [
                            // scenario 1
                            { 
                                'startAttack' : {'Gather Victim Network Information' : false},
                                'Gather Victim Network Information': {"Exploit Public-Facing Application" : false, "Phishing" : false, "Valid Accounts" : false},
                                'Exploit Public-Facing Application' :  {"Command and Scripting Interpreter" : false, "Software Deployment Tools": false},
                                'Phishing' : {"Command and Scripting Interpreter" : false, "Software Deployment Tools" : false},
                                'Valid Accounts' : {"Command and Scripting Interpreter": false, "Software Deployment Tools": false},
                                'Command and Scripting Interpreter' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Software Deployment Tools' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Account Manipulation' : {"Abuse Elevation Control Mechanism": false, "Indirect Command Execution": false},
                                'Scheduled Task/Job' : {"Screen Capture": false,"Exfiltration Over Alternative Protocol": false,"Exfiltration Over Web Service": false},
                                'Abuse Elevation Control Mechanism' : {"Brute Force": false, "Account Discovery": false},
                                'Indirect Command Execution' : {"Brute Force": false},
                                'Screen Capture' : {"Communication Through Removable Media": false},
                                'Exfiltration Over Alternative Protocol' : {"Data Encrypted for Impact": false},
                                'Exfiltration Over Web Service' : {"Data Encrypted for Impact": false}
                            },
                            // scenario 2 
                            {
                                'startAttack' : {'Obtain Capabilities' : false},
                                "Obtain Capabilities" : {"Drive-by Compromise" : false, "Native API" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false},
                                "Brute Force" : {"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false,  "System Information Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false},
                                "Browser Bookmark Discovery" : {"Clipboard Data": false},
                                "File and Directory Discovery" : {"Data from Local System": false},
                                "Network Share Discovery" : {"Data from Local System": false},
                                "Process Discovery"  : {"Data from Local System": false},
                                "System Information Discovery" : {"Clipboard Data": false},
                                "System Network Configuration Discovery" : {"Data from Local System": false},
                                "System Network Connections Discovery": {"Data from Local System": false},
                                "Clipboard Data" : {"Ingress Tool Transfer": false,  "System Shutdown/Reboot": false},
                                "Data from Local System" : {"Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot" : false},
                            },

                            // scenario 3
                            {
                                "startAttack" : {"Gather Victim Org Information" : false, "Search Victim-Owned Websites" : false},
                                "Gather Victim Org Information" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Search Victim-Owned Websites" : {"Develop Capabilities": false},
                                "Develop Capabilities" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Exploit Public-Facing Application" : {"Account Manipulation": false},
                                "External Remote Services" : {"Account Manipulation": false, "Browser Extensions": false},
                                "Account Manipulation" :  {"Process Injection": false},
                                "Browser Extensions" :  {"Process Injection": false},
                                "Process Injection" : {"Deobfuscate/Decode Files or Information": false,"Multi-Factor Authentication Interception": false, "Masquerading": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Multi-Factor Authentication Interception": false},
                                "Masquerading" : { "Network Sniffing": false},
                                "Modify Registry" : {"Query Registry": false},
                                "Obfuscated Files or Information" : {"System Information Discovery": false, "System Network Configuration Discovery": false, "System Service Discovery": false},
                                "Multi-Factor Authentication Interception" : {"File and Directory Discovery": false, "Process Discovery": false},
                                "File and Directory Discovery" : {"Internal Spearphishing": false, "Data from Local System": false},
                                "Network Sniffing": {"Internal Spearphishing": false}, 
                                "Process Discovery" :{"Data from Local System": false},
                                "Query Registry":{"Data from Local System": false}, 
                                "System Information Discovery" : {"Remote Access Software": false},
                                "System Network Configuration Discovery": {"Remote Access Software": false},
                                "System Service Discovery" : {"Ingress Tool Transfer": false},
                                "Internal Spearphishing": {"Adversary-in-the-Middle": false, "Data from Local System": false,"Exfiltration Over C2 Channel": false},
                                "Adversary-in-the-Middle" : {"Remote Access Software": false}, 
                                "Data from Local System": {"Ingress Tool Transfer": false}
                            
                            },

                            // scenario 4
                            {
                                "startAttack" : {"Drive-by Compromise" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false,"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false, "System Information Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false},
                                "Browser Bookmark Discovery" :  {"Clipboard Data": false},
                                "File and Directory Discovery":  {"Clipboard Data": false},
                                "Network Share Discovery":  {"Data from Local System": false},
                                "Process Discovery":  {"Data from Local System": false}, 
                                "System Information Discovery":  {"Data from Local System": false},
                                "System Network Connections Discovery":  {"Data from Local System": false},
                                "System Owner/User Discovery":  {"Data from Local System": false},
                                "Clipboard Data":  {"System Shutdown/Reboot": false },
                                "Data from Local System" :  {"Ingress Tool Transfer": false, "Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot": false }
                            },

                            // scenario 5
                            {
                                "startAttack" : {"Drive-by Compromise" : false, "Exploit Public-Facing Application" : false},
                                "Drive-by Compromise": {"Windows Management Instrumentation": false},
                                "Exploit Public-Facing Application": {"Windows Management Instrumentation": false},
                                "Windows Management Instrumentation" :{"Scheduled Task/Job": false},
                                "Scheduled Task/Job" : {"Deobfuscate/Decode Files or Information": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Domain Trust Discovery": false, "System Network Configuration Discovery": false,  "System Owner/User Discovery" : false },
                                "Modify Registry" : {"Process Discovery": false},
                                "Obfuscated Files or Information"  : {"Remote System Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false, "System Service Discovery": false },
                                "Domain Trust Discovery" : {"Proxy": false},
                                "Process Discovery" : {"Proxy": false},
                                "Remote System Discovery" : {"Exploitation of Remote Services": false},
                                "System Network Configuration Discovery": {"Proxy": false},
                                "System Network Connections Discovery":{"Proxy": false},
                                "System Owner/User Discovery":{"Proxy": false},
                                "System Service Discovery": {"Proxy": false},
                            }
                        ]
                    }),
    
                    new Section({
                        attackable : true,
                        defensible : true,
                        destroyStatus : true ,
                        level  : 1,
                        suspicionCount : 0,
                        attackProgress : [],
                        // attackSenarioProgress  : [ ['Gather Victim Network Information', 'Exploit Public-Facing Application', 'Phishing'] ],
                        attackSenarioProgress  : [[], [], [], [], []],
                        defenseProgress : [[], [], [], [], []],
                        beActivated : [],
                        defenseActive: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 활성화된 방어
                        defenseLv : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 레벨 
                        defenseCnt : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 횟수 
                        attackConn : [
                            // scenario 1
                            { 
                                'startAttack' : {'Gather Victim Network Information' : false},
                                'Gather Victim Network Information': {"Exploit Public-Facing Application" : false, "Phishing" : false, "Valid Accounts" : false},
                                'Exploit Public-Facing Application' :  {"Command and Scripting Interpreter" : false, "Software Deployment Tools": false},
                                'Phishing' : {"Command and Scripting Interpreter" : false, "Software Deployment Tools" : false},
                                'Valid Accounts' : {"Command and Scripting Interpreter": false, "Software Deployment Tools": false},
                                'Command and Scripting Interpreter' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Software Deployment Tools' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Account Manipulation' : {"Abuse Elevation Control Mechanism": false, "Indirect Command Execution": false},
                                'Scheduled Task/Job' : {"Screen Capture": false,"Exfiltration Over Alternative Protocol": false,"Exfiltration Over Web Service": false},
                                'Abuse Elevation Control Mechanism' : {"Brute Force": false, "Account Discovery": false},
                                'Indirect Command Execution' : {"Brute Force": false},
                                'Screen Capture' : {"Communication Through Removable Media": false},
                                'Exfiltration Over Alternative Protocol' : {"Data Encrypted for Impact": false},
                                'Exfiltration Over Web Service' : {"Data Encrypted for Impact": false}
                            },
                            // scenario 2 
                            {
                                'startAttack' : {'Obtain Capabilities' : false},
                                "Obtain Capabilities" : {"Drive-by Compromise" : false, "Native API" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false},
                                "Brute Force" : {"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false,  "System Information Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false},
                                "Browser Bookmark Discovery" : {"Clipboard Data": false},
                                "File and Directory Discovery" : {"Data from Local System": false},
                                "Network Share Discovery" : {"Data from Local System": false},
                                "Process Discovery"  : {"Data from Local System": false},
                                "System Information Discovery" : {"Clipboard Data": false},
                                "System Network Configuration Discovery" : {"Data from Local System": false},
                                "System Network Connections Discovery": {"Data from Local System": false},
                                "Clipboard Data" : {"Ingress Tool Transfer": false,  "System Shutdown/Reboot": false},
                                "Data from Local System" : {"Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot" : false},
                            },

                            // scenario 3
                            {
                                "startAttack" : {"Gather Victim Org Information" : false, "Search Victim-Owned Websites" : false},
                                "Gather Victim Org Information" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Search Victim-Owned Websites" : {"Develop Capabilities": false},
                                "Develop Capabilities" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Exploit Public-Facing Application" : {"Account Manipulation": false},
                                "External Remote Services" : {"Account Manipulation": false, "Browser Extensions": false},
                                "Account Manipulation" :  {"Process Injection": false},
                                "Browser Extensions" :  {"Process Injection": false},
                                "Process Injection" : {"Deobfuscate/Decode Files or Information": false,"Multi-Factor Authentication Interception": false, "Masquerading": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Multi-Factor Authentication Interception": false},
                                "Masquerading" : { "Network Sniffing": false},
                                "Modify Registry" : {"Query Registry": false},
                                "Obfuscated Files or Information" : {"System Information Discovery": false, "System Network Configuration Discovery": false, "System Service Discovery": false},
                                "Multi-Factor Authentication Interception" : {"File and Directory Discovery": false, "Process Discovery": false},
                                "File and Directory Discovery" : {"Internal Spearphishing": false, "Data from Local System": false},
                                "Network Sniffing": {"Internal Spearphishing": false}, 
                                "Process Discovery" :{"Data from Local System": false},
                                "Query Registry":{"Data from Local System": false}, 
                                "System Information Discovery" : {"Remote Access Software": false},
                                "System Network Configuration Discovery": {"Remote Access Software": false},
                                "System Service Discovery" : {"Ingress Tool Transfer": false},
                                "Internal Spearphishing": {"Adversary-in-the-Middle": false, "Data from Local System": false,"Exfiltration Over C2 Channel": false},
                                "Adversary-in-the-Middle" : {"Remote Access Software": false}, 
                                "Data from Local System": {"Ingress Tool Transfer": false}
                            
                            },

                            // scenario 4
                            {
                                "startAttack" : {"Drive-by Compromise" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false,"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false, "System Information Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false},
                                "Browser Bookmark Discovery" :  {"Clipboard Data": false},
                                "File and Directory Discovery":  {"Clipboard Data": false},
                                "Network Share Discovery":  {"Data from Local System": false},
                                "Process Discovery":  {"Data from Local System": false}, 
                                "System Information Discovery":  {"Data from Local System": false},
                                "System Network Connections Discovery":  {"Data from Local System": false},
                                "System Owner/User Discovery":  {"Data from Local System": false},
                                "Clipboard Data":  {"System Shutdown/Reboot": false },
                                "Data from Local System" :  {"Ingress Tool Transfer": false, "Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot": false }
                            },

                            // scenario 5
                            {
                                "startAttack" : {"Drive-by Compromise" : false, "Exploit Public-Facing Application" : false},
                                "Drive-by Compromise": {"Windows Management Instrumentation": false},
                                "Exploit Public-Facing Application": {"Windows Management Instrumentation": false},
                                "Windows Management Instrumentation" :{"Scheduled Task/Job": false},
                                "Scheduled Task/Job" : {"Deobfuscate/Decode Files or Information": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Domain Trust Discovery": false, "System Network Configuration Discovery": false,  "System Owner/User Discovery" : false },
                                "Modify Registry" : {"Process Discovery": false},
                                "Obfuscated Files or Information"  : {"Remote System Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false, "System Service Discovery": false },
                                "Domain Trust Discovery" : {"Proxy": false},
                                "Process Discovery" : {"Proxy": false},
                                "Remote System Discovery" : {"Exploitation of Remote Services": false},
                                "System Network Configuration Discovery": {"Proxy": false},
                                "System Network Connections Discovery":{"Proxy": false},
                                "System Owner/User Discovery":{"Proxy": false},
                                "System Service Discovery": {"Proxy": false},
                            }
                        ]
                    }),
    
                    new Section({
                        attackable : true,
                        defensible : true,
                        destroyStatus : false ,
                        level  : 1,
                        suspicionCount : 0,
                        attackProgress : [],
                        // attackSenarioProgress  : [ ['Gather Victim Network Information', 'Exploit Public-Facing Application', 'Phishing'] ],
                        attackSenarioProgress  : [[], [], [], [], []],
                        defenseProgress : [[], [], [], [], []],
                        beActivated : [],
                        defenseActive: [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 활성화된 방어
                        defenseLv : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 레벨 
                        defenseCnt : [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0],
                                    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], // 방어 횟수 
                        attackConn : [
                            // scenario 1
                            { 
                                'startAttack' : {'Gather Victim Network Information' : false},
                                'Gather Victim Network Information': {"Exploit Public-Facing Application" : false, "Phishing" : false, "Valid Accounts" : false},
                                'Exploit Public-Facing Application' :  {"Command and Scripting Interpreter" : false, "Software Deployment Tools": false},
                                'Phishing' : {"Command and Scripting Interpreter" : false, "Software Deployment Tools" : false},
                                'Valid Accounts' : {"Command and Scripting Interpreter": false, "Software Deployment Tools": false},
                                'Command and Scripting Interpreter' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Software Deployment Tools' : {"Account Manipulation": false, "Scheduled Task/Job": false},
                                'Account Manipulation' : {"Abuse Elevation Control Mechanism": false, "Indirect Command Execution": false},
                                'Scheduled Task/Job' : {"Screen Capture": false,"Exfiltration Over Alternative Protocol": false,"Exfiltration Over Web Service": false},
                                'Abuse Elevation Control Mechanism' : {"Brute Force": false, "Account Discovery": false},
                                'Indirect Command Execution' : {"Brute Force": false},
                                'Screen Capture' : {"Communication Through Removable Media": false},
                                'Exfiltration Over Alternative Protocol' : {"Data Encrypted for Impact": false},
                                'Exfiltration Over Web Service' : {"Data Encrypted for Impact": false}
                            },
                            // scenario 2 
                            {
                                'startAttack' : {'Obtain Capabilities' : false},
                                "Obtain Capabilities" : {"Drive-by Compromise" : false, "Native API" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false},
                                "Brute Force" : {"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false,  "System Information Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false},
                                "Browser Bookmark Discovery" : {"Clipboard Data": false},
                                "File and Directory Discovery" : {"Data from Local System": false},
                                "Network Share Discovery" : {"Data from Local System": false},
                                "Process Discovery"  : {"Data from Local System": false},
                                "System Information Discovery" : {"Clipboard Data": false},
                                "System Network Configuration Discovery" : {"Data from Local System": false},
                                "System Network Connections Discovery": {"Data from Local System": false},
                                "Clipboard Data" : {"Ingress Tool Transfer": false,  "System Shutdown/Reboot": false},
                                "Data from Local System" : {"Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot" : false},
                            },

                            // scenario 3
                            {
                                "startAttack" : {"Gather Victim Org Information" : false, "Search Victim-Owned Websites" : false},
                                "Gather Victim Org Information" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Search Victim-Owned Websites" : {"Develop Capabilities": false},
                                "Develop Capabilities" : {"Exploit Public-Facing Application": false, "External Remote Services" : false},
                                "Exploit Public-Facing Application" : {"Account Manipulation": false},
                                "External Remote Services" : {"Account Manipulation": false, "Browser Extensions": false},
                                "Account Manipulation" :  {"Process Injection": false},
                                "Browser Extensions" :  {"Process Injection": false},
                                "Process Injection" : {"Deobfuscate/Decode Files or Information": false,"Multi-Factor Authentication Interception": false, "Masquerading": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Multi-Factor Authentication Interception": false},
                                "Masquerading" : { "Network Sniffing": false},
                                "Modify Registry" : {"Query Registry": false},
                                "Obfuscated Files or Information" : {"System Information Discovery": false, "System Network Configuration Discovery": false, "System Service Discovery": false},
                                "Multi-Factor Authentication Interception" : {"File and Directory Discovery": false, "Process Discovery": false},
                                "File and Directory Discovery" : {"Internal Spearphishing": false, "Data from Local System": false},
                                "Network Sniffing": {"Internal Spearphishing": false}, 
                                "Process Discovery" :{"Data from Local System": false},
                                "Query Registry":{"Data from Local System": false}, 
                                "System Information Discovery" : {"Remote Access Software": false},
                                "System Network Configuration Discovery": {"Remote Access Software": false},
                                "System Service Discovery" : {"Ingress Tool Transfer": false},
                                "Internal Spearphishing": {"Adversary-in-the-Middle": false, "Data from Local System": false,"Exfiltration Over C2 Channel": false},
                                "Adversary-in-the-Middle" : {"Remote Access Software": false}, 
                                "Data from Local System": {"Ingress Tool Transfer": false}
                            
                            },

                            // scenario 4
                            {
                                "startAttack" : {"Drive-by Compromise" : false},
                                "Drive-by Compromise" : {"Native API": false},
                                "Native API" : {"Modify Registry": false},
                                "Modify Registry" : {"Brute Force": false,"Browser Bookmark Discovery": false, "File and Directory Discovery": false, "Network Share Discovery": false, "Process Discovery": false, "System Information Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false},
                                "Browser Bookmark Discovery" :  {"Clipboard Data": false},
                                "File and Directory Discovery":  {"Clipboard Data": false},
                                "Network Share Discovery":  {"Data from Local System": false},
                                "Process Discovery":  {"Data from Local System": false}, 
                                "System Information Discovery":  {"Data from Local System": false},
                                "System Network Connections Discovery":  {"Data from Local System": false},
                                "System Owner/User Discovery":  {"Data from Local System": false},
                                "Clipboard Data":  {"System Shutdown/Reboot": false },
                                "Data from Local System" :  {"Ingress Tool Transfer": false, "Data Destruction": false,"Data Encrypted for Impact": false, "System Shutdown/Reboot": false }
                            },

                            // scenario 5
                            {
                                "startAttack" : {"Drive-by Compromise" : false, "Exploit Public-Facing Application" : false},
                                "Drive-by Compromise": {"Windows Management Instrumentation": false},
                                "Exploit Public-Facing Application": {"Windows Management Instrumentation": false},
                                "Windows Management Instrumentation" :{"Scheduled Task/Job": false},
                                "Scheduled Task/Job" : {"Deobfuscate/Decode Files or Information": false, "Modify Registry": false, "Obfuscated Files or Information" : false},
                                "Deobfuscate/Decode Files or Information" : {"Domain Trust Discovery": false, "System Network Configuration Discovery": false,  "System Owner/User Discovery" : false },
                                "Modify Registry" : {"Process Discovery": false},
                                "Obfuscated Files or Information"  : {"Remote System Discovery": false, "System Network Configuration Discovery": false, "System Network Connections Discovery": false, "System Owner/User Discovery": false, "System Service Discovery": false },
                                "Domain Trust Discovery" : {"Proxy": false},
                                "Process Discovery" : {"Proxy": false},
                                "Remote System Discovery" : {"Exploitation of Remote Services": false},
                                "System Network Configuration Discovery": {"Proxy": false},
                                "System Network Connections Discovery":{"Proxy": false},
                                "System Owner/User Discovery":{"Proxy": false},
                                "System Service Discovery": {"Proxy": false},
                            }
                        ]
                    }),
                ]
            });

            initCompanyArray.push(initCompany);
            console.log("[Init Game] initCompanyArray : ", initCompanyArray);
        }

        var RoomTotalJson  = {
            roomPin : room_key,
            server_start  : new Date(),
            server_end  :  new Date(),
            blackTeam  : new BlackTeam({ 
                total_pita : 500,
                users : blackUsers,
                scenarioLevel : [-1,-1,-1, -1, -1], // 힌트북 레벨
            }),
            whiteTeam  : new WhiteTeam({ 
                total_pita : 500,
                users : whiteUsers
            }),
            companyA    : initCompanyArray[0],
            companyB    : initCompanyArray[1],
            companyC    : initCompanyArray[2],
            companyD    : initCompanyArray[3],
            companyE    : initCompanyArray[4],
        };
      
        return RoomTotalJson
    }

    async function AttackCoolTime(socket, lvCoolTime, corpName, sectionIdx, tacticIdx, attackLv, tacticName, attackName){
        var attackTime = setTimeout(async function(){

            let prob = config["ATTACK_" + (tacticIdx + 1)]["success"][attackLv] * 0.01;
            let percent = Math.random();
            prob = 1; 

            if (prob >= percent) {
                let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                var attackProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress;

                attackProgressArr.filter( async (element) => {
                    if(element.attackName == attackName && element.state == 1) {
                        element.state = 2;
                    }
                })

                roomTotalJson[0][corpName].sections[sectionIdx].attackProgress = attackProgressArr;
                await jsonStore.updatejson(roomTotalJson[0], socket.room);
    
                const roomTotalJson2 = JSON.parse(await jsonStore.getjson(socket.room));
                var sectionAttackProgressArr2 = roomTotalJson2[0]["companyA"].sections[0].attackProgress;

                let today = new Date();   
                let hours = today.getHours();
                let minutes = today.getMinutes();
                let seconds = today.getSeconds(); 
                let now = hours+":"+minutes+":"+seconds;
                var gameLog = {time: now, nickname: socket.nickname, targetCompany: corpName, targetSection: areaNameList[sectionIdx], detail: attackName+" is completed."};

                var logArr = [];
                logArr.push(gameLog);
                io.sockets.in(socket.room+'false').emit('addLog', logArr);

                CheckScenarioAttack(socket, corpName, sectionIdx, tacticName, attackName); 

            } else{
                socket.emit('Failed to success rate');

                let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
                var attackProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress;

                attackProgressArr.filter(async (element, index) => {
                    if(element.attackName == attackName && element.state == 1) {
                        attackProgressArr.splice(index, 1);

                        await jsonStore.updatejson(roomTotalJson[0], socket.room);
    
                        const roomTotalJson2 = JSON.parse(await jsonStore.getjson(socket.room));
                        var sectionAttackProgressArr2 = roomTotalJson2[0]["companyA"].sections[0].attackProgress;
                    }
                });

            }
            clearTimeout(attackTime);

        }, lvCoolTime);
    }

    async function CheckScenarioAttack(socket, corpName, sectionIdx, tacticName, attackName){
        const roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        var attackSenarioProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].attackSenarioProgress;
        var attackProgress = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress;
        var attackConn = roomTotalJson[0][corpName].sections[sectionIdx].attackConn;

        for (var i = 0; i < attackConn.length; i++) {
            var scenarioName = "SCENARIO" + (i + 1);
            var startAttackArr = (Object.values(config[scenarioName].startAttack));


            if(startAttackArr.includes(attackName)) {

                var newInfo = { tactic: tacticName, attackName: attackName }; 
                attackSenarioProgressArr[i].push(newInfo);
                attackConn[i]["startAttack"][attackName] = true;
                socket.emit('Attack Success');

            } else {
                for(key in attackConn[i]) {
                    var attackConnArr = (Object.keys(attackConn[i][key]));
                    if (attackConnArr.includes(attackName)) {
                        if (attackConnArr[attackName] == true) {
                            var newInfo = { tactic: tacticName, attackName: attackName }; 
                            attackSenarioProgressArr[i].push(newInfo);
                            socket.emit('Attack Success');
                        } else {
                            var attackInfo = attackProgress.filter(function(progress){
                                return progress.attackName == attackName && progress.tactic == tacticName;
                            })[0];
                            
                            if (typeof attackInfo != "undefined" && attackInfo.state == 2) {
                                var parents = config[scenarioName].attackConnParent[key];

                                if (typeof parents != "undefined" && parents.length > 0){ 
                                    for (var pIdx = 0; pIdx < parents.length; pIdx++) {
                                        console.log("parents[pIdx] : ", parents[pIdx]);
                                        console.log("key : ", key);
                                        console.log("i : ", i);
                                        console.log("pIdx : ", pIdx);
                                        console.log("attackConn[i][parents[pIdx]][key] : ", attackConn[i][parents[pIdx]][key]);
                                        if (attackConn[i][parents[pIdx]][key] == true) {
                                            var newInfo = { tactic: tacticName, attackName: attackName }; 
                                            attackSenarioProgressArr[i].push(newInfo);
                                            attackConn[i][key][attackName] = true;
                                            socket.emit('Attack Success');
                                            console.log("attackConn : ", attackConn);

                                            var mainAttackArr = (Object.values(config["SCENARIO" + (i+1)].mainAttack));
                                            console.log("mainAttackArr : ", mainAttackArr);
                                            console.log("mainAttackArr[mainAttackArr.length -1] : ", mainAttackArr[mainAttackArr.length -1]);
                                            if (mainAttackArr[mainAttackArr.length -1] == attackName && sectionIdx == 2) {
                                                console.log("abandonStatus : false to true : ", attackName);
                                                roomTotalJson[0][corpName].abandonStatus = true;
                                                io.sockets.in(socket.room).emit("Abandon Company", corpName);
                                                AllAbandon(socket, roomTotalJson);
                                            } else if (mainAttackArr[-1] == attackName) {
                                                roomTotalJson[0][corpName].sections[sectionIdx].destroyStatus = true;
                                                roomTotalJson[0][corpName].sections[sectionIdx+1].attackable = true;
                                            }

                                            break;
                                        }
                                    }
                                } else if (startAttackArr.includes(key)) {
                                    var newInfo = { tactic: tacticName, attackName: attackName }; 
                                    attackSenarioProgressArr[i].push(newInfo);
                                    attackConn[i][key][attackName] = true;
                                    socket.emit('Attack Success');
                                    console.log("attackConn : ", attackConn);
                                }
                            }
                        }
                    }
                }
            }
        
            // console.log("attackConn : ", attackConn);
        }

        roomTotalJson[0][corpName].sections[sectionIdx].attackSenarioProgress = attackSenarioProgressArr;

        await jsonStore.updatejson(roomTotalJson[0], socket.room);

        const roomTotalJson2 = JSON.parse(await jsonStore.getjson(socket.room));
        var attackSenarioProgressArr2 = roomTotalJson2[0][corpName].sections[sectionIdx].attackSenarioProgress;
        console.log(attackSenarioProgressArr2);
    }

    // Defense 쿨타임
    async function DefenseCooltime(socket, attackStateOrigin, corpName, sectionIdx, tacticIndex, techniqueIndex, defenseLevel){
        var defenseTime = setTimeout(async function(){
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            var sectionDefenseProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].defenseProgress;
            var sectionAttackProgressArr = roomTotalJson[0][corpName].sections[sectionIdx].attackProgress;
            var defenseCntArr = roomTotalJson[0][corpName].sections[sectionIdx].defenseCnt;
            var defenseLvArr = roomTotalJson[0][corpName].sections[sectionIdx].defenseLv;

            console.log("tacticIndex : ", tacticIndex);
            console.log("techniqueIndex : ", techniqueIndex);
            
            var attackInfo = sectionAttackProgressArr.filter(function(progress){
                return progress.tactic == config.ATTACK_CATEGORY[tacticIndex] && progress.attackName == config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex];
            })[0];

            console.log("attackInfo : ", attackInfo);

            if (typeof attackInfo != "undefined") {
                let prob = config["DEFENSE_" + (tacticIndex + 1)]["success"][defenseLevel] * 0.01;
                let percent = Math.random();

                console.log("prob : ", prob, ", percent : ", percent); 

                // 대응 성공
                if (prob >= percent) {
                    console.log("DefenseCooltime - attackInfo : ", attackInfo);
                    console.log("DefenseCooltime - config.ATTACK_CATEGORY[tacticIndex] : ", config.ATTACK_CATEGORY[tacticIndex]);
                    console.log("DefenseCooltime - config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex] : ", config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex]);
                    
                    console.log("DefenseCooltime - sectionAttackProgressArr (before) : ", sectionAttackProgressArr);
                    console.log("DefenseCooltime - sectionDefenseProgressArr (before) : ", sectionDefenseProgressArr);
        
                    // 방어 성공 (attackStateOrigin -> attackState : 1 -> 1 or 2 -> 2)
                    console.log("DefenseCooltime - attackStateOrigin : ", attackStateOrigin);
                    console.log("DefenseCooltime - attackInfo.state : ", attackInfo.state);
                    if (attackStateOrigin == attackInfo.state) {
                        console.log("DefenseCooltime - success!!");
        
                        sectionAttackProgressArr = sectionAttackProgressArr.filter(function(progress){
                            return progress.tactic != config.ATTACK_CATEGORY[tacticIndex] && progress.attackName != config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex];
                        });
        
                        sectionDefenseProgressArr = sectionDefenseProgressArr.filter(function(progress){
                            return progress.tactic != config.ATTACK_CATEGORY[tacticIndex] && progress.attackName != config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex];
                        });

                        defenseCntArr[tacticIndex][techniqueIndex] += 1;

                        if (defenseLvArr != 5 & defenseCntArr[tacticIndex][techniqueIndex] > config.DEFENSE_TECHNIQUE_UPGRADE) {
                            defenseLvArr += 1;
                        }

                        // [GameLog] 로그 추가
                        let today = new Date();
                        let hours = today.getHours(); // 시
                        let minutes = today.getMinutes();  // 분
                        let seconds = today.getSeconds();  // 초
                        let now = hours+":"+minutes+":"+seconds;
                        var gameLog = {time: now, nickname: "", targetCompany: corpName, targetSection: areaNameList[sectionIdx], detail: config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex]+" response has been completed."};
                        var logArr = [];
                        logArr.push(gameLog);
                        io.sockets.in(socket.room+'true').emit('addLog', logArr);
                        
                    } else {   // 방어 실패
                        console.log("DefenseCooltime - faile!!");
                        socket.emit('Failed to defense');
                        automaticDefense(socket, corpName, sectionIdx, tacticIndex, techniqueIndex);
                        return;
        
                        // sectionDefenseProgressArr = sectionDefenseProgressArr.filter(function(progress){
                        //     return progress.tactic != config.ATTACK_CATEGORY[tacticIndex] && progress.attackName != config.ATTACK_TECHNIQUE[techniqueIndex];
                        // });
        
                        // DefenseCooltime(socket, attackInfo.state, corpName, sectionIdx, tacticIndex, techniqueIndex, defenseLevel);
                    }
        
                    console.log("DefenseCooltime - sectionAttackProgressArr (after) : ", sectionAttackProgressArr);
                    roomTotalJson[0][corpName].sections[sectionIdx].attackProgress = sectionAttackProgressArr;
                    roomTotalJson[0][corpName].sections[sectionIdx].defenseProgress = sectionDefenseProgressArr;
                    console.log("DefenseCooltime - roomTotalJson[0][corpName].sections[sectionIdx].defenseProgress (after) : ", roomTotalJson[0][corpName].sections[sectionIdx].defenseProgress);
        
                    await jsonStore.updatejson(roomTotalJson[0], socket.room);

                } else { // 공격 실패 (성공률로 인해)
                    console.log("Failed due to success rate!!")
                    socket.emit('Failed to success rate');
                    automaticDefense(socket, corpName, sectionIdx, tacticIndex, techniqueIndex);
                    return;
                    // DefenseCooltime(socket, attackInfo.state, corpName, sectionIdx, tacticIndex, techniqueIndex, defenseLevel);
                }
            }

            clearTimeout(defenseTime);
            
        }, config["DEFENSE_" + (tacticIndex + 1)]["time"][defenseLevel] * 1000);
    }

    

        // 자동 대응 수행
        async function automaticDefense(socket, companyName, section, tacticIndex, techniqueIndex) {
            let roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
            var sectionAttackProgressArr = roomTotalJson[0][companyName].sections[section].attackProgress;

            var attackInfo = sectionAttackProgressArr.filter(function(progress){
                return progress.tactic == config.ATTACK_CATEGORY[tacticIndex] && progress.attackName == config.ATTACK_TECHNIQUE[tacticIndex][techniqueIndex];
            })[0];
            
            console.log("automaticDefense - companyName : ", companyName);
            console.log("automaticDefense - section : ", section);
            console.log("automaticDefense - tacticIndex : ", tacticIndex);
            console.log("automaticDefense - techniqueIndex : ", techniqueIndex);

            let cardLv;
            let pitaNum = 0;
            if (socket.team == true) {
                console.log("white team upgrade attack card");
                cardLv = roomTotalJson[0][companyName]["penetrationTestingLV"][tacticIndex];
                if (cardLv < 5) {
                    pitaNum = roomTotalJson[0]['whiteTeam']['total_pita'] - config["DEFENSE_" + (tacticIndex + 1)]['pita'][cardLv];
                    roomTotalJson[0]['whiteTeam']['total_pita'] = pitaNum;

                    console.log("[!!!!!] pita num : ", pitaNum);
                }
            }

            if (pitaNum >= 0 && cardLv < 5) {
                socket.to(socket.room + socket.team).emit('Update Pita', pitaNum);
                socket.emit('Update Pita', pitaNum);

                let techniqueBeActivationList = roomTotalJson[0][companyName]["sections"][section]["beActivated"];
                techniqueBeActivationList.length = 0;
                
                let techniqueActivation = roomTotalJson[0][companyName]["sections"][section]["defenseActive"];
                let techniqueLevel = roomTotalJson[0][companyName]["sections"][section]["defenseLv"];

                // white team -> 공격을 선택할 수 있도록 함
                DefenseCooltime(socket, attackInfo.state, companyName, section, tacticIndex, techniqueIndex, cardLv);
                // socket.emit('Start Defense', companyName, section, tacticIndex, techniqueIndex, config["DEFENSE_" + (categoryIndex + 1)]["time"][techniqueLevel[categoryIndex][techniqueBeActivationList[i]]]);
                socket.emit('Start Defense', companyName, section, tacticIndex, techniqueIndex, config["DEFENSE_1"]["time"][techniqueLevel[categoryIndex][techniqueBeActivationList[i]]]);

                await jsonStore.updatejson(roomTotalJson[0], socket.room);
                roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));

            } else {
                console.log("Something Problem!!!")
                console.log("pitanum : ", pitaNum)
                console.log("cardLv : ", cardLv)
                if (pitaNum < 0){
                    console.log("업그레이드 실패!! >> pita 부족");
                    socket.emit("Short of Money");
                } else if (cardLv >= 5){
                    console.log("업그레이드 실패!! >> 만랩 달성");
                    socket.emit("Already Max Level");
                }
            }

            await jsonStore.updatejson(roomTotalJson[0], socket.room);
            roomTotalJson = JSON.parse(await jsonStore.getjson(socket.room));
        }


    // 모든 회사가 몰락인지 확인, 몰락이면 게임 종료
    async function AllAbandon(socket, roomTotalJson){
        var gameover = true;
        for(let company of companyNameList){
            if(roomTotalJson[0][company]["abandonStatus"] == false){
                gameover = false;
                break;
            }
        }
        
        var winTeam = false;
        if(gameover){
            clearInterval(timerId);
            clearInterval(pitaTimerId);
            io.sockets.in(socket.room).emit('Timer END'); 
            io.sockets.in(socket.room).emit('Load_ResultPage');
            socket.on('Finish_Load_ResultPage', async()=> {

                var blackPitaNum = roomTotalJson[0]["blackTeam"]["total_pita"];
                var whitePitaNum = roomTotalJson[0]["whiteTeam"]["total_pita"];
                var whiteScore = whitePitaNum;
                var blackScore = (5 * 1000) + blackPitaNum;

                if(whiteScore > blackScore){
                    winTeam = true;
                } else if (whiteScore < blackScore){
                    winTeam = false;
                } else {
                    winTeam = null;
                }
                io.sockets.in(socket.room).emit('Abandon_Gameover', winTeam, blackScore, whiteScore);

                await SaveDeleteGameInfo(socket.room);
            });
        }
    }


    async function TimeOverGameOver(socket, roomTotalJson){   
        var aliveCnt = 0;
        for(let company of companyNameList){
            if(roomTotalJson[0][company]["abandonStatus"] == false){
                aliveCnt++;
            }
        }
        var blackPitaNum = roomTotalJson[0]["blackTeam"]["total_pita"];
        var whitePitaNum = roomTotalJson[0]["whiteTeam"]["total_pita"];
        var whiteScore = (aliveCnt * 1000) + whitePitaNum;
        var blackScore = ((5-aliveCnt) * 1000) + blackPitaNum;

        var winTeam = null;
        if(whiteScore > blackScore){
            winTeam = true;
        } else if (whiteScore < blackScore){
            winTeam = false;
        } else {
            winTeam = null;
        }

        io.sockets.in(socket.room).emit('Timeout_Gameover', winTeam, blackScore, whiteScore);

        await SaveDeleteGameInfo(socket.room);
    }   


  async function SaveDeleteGameInfo(roomPin){        
    // 게임 정보 저장 (mongoDB)
    var gameTotalJson = JSON.parse(await jsonStore.getjson(roomPin));
    var gameTotalScm = new RoomTotalSchema(gameTotalJson[0]);
    // func.InsertGameRoomTotal(gameTotalScm);


    // 룸 정보 저장 (mongoDB)
    // 해당 룸의 모든 사용자 정보 가져와 new user 정보 추가 후 update
    var roomMembersList =  await redis_room.RoomMembers(roomPin);
    var roomMembersDict = {}

    var user;
    for (const member of roomMembersList){
        // roomMembersDict[member] = await redis_room.getMember(room, member);
        user = await redis_room.getMember(roomPin, member);

        // roomMembersDict[member] = ({
        //     new BlackUsers(
        //     userID   : user.userID,
        //     nickname : user.nickname,
        //     team : user.team,
        //     status : user.status,
        //     color : user.color,
        //     place : user.place,
        //     socketID : user.socketID,
        // });
        roomMembersDict[member] = new User(user);
    }   
    console.log('!!!~~roomMembersDict', roomMembersDict);

    // roomInfo 정보
    var roomInfo = JSON.parse(await redis_room.getRoomInfo(roomPin));
    console.log('!!!~~roomInfo', roomInfo);
    var roomInfoScm = new RoomInfo(roomInfo);
    console.log('!!!~~roomInfoScm', roomInfoScm);

    // 합치기 
    var roomTotalScm = new RoomInfoTotal({
        Users :roomMembersDict, 
        Info : roomInfoScm
    });
    // func.InsertRoomInfoTotal(roomTotalScm);

    // 게임 정보 삭제 (redis)
    await jsonStore.deletejson(roomPin);

     // 룸 정보 삭제 (redis)
    redis_room.deleteRooms(roomPin); 
  }
    
}

