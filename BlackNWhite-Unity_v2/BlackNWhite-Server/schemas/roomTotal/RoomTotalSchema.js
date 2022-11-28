// schemas/room.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const CompanySchema = require("./Company").schema;

const WhiteTeam = require("./WhiteTeam").schema;
const BlackTeam = require("./BlackTeam").schema;


const RoomTotalSchema = new Schema({
    roomPin    : { type : String, required : true },
    server_start  : { type : Date, required : true },
    server_end  : { type : Date, required : true },
    blackTeam  : { type : BlackTeam, required : true },
    whiteTeam  : { type : WhiteTeam, required : true },
    companyA    : { type : CompanySchema, required : true },
    companyB    : { type : CompanySchema, required : true },
    companyC    : { type : CompanySchema, required : true },
    companyD    : { type : CompanySchema, required : true },
    companyE    : { type : CompanySchema, required : true },
})

module.exports = mongoose.model('RoomTotalSchema', RoomTotalSchema);

