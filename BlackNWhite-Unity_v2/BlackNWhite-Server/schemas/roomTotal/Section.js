const mongoose = require('mongoose');
const { Schema } = mongoose;

const Section = new Schema({
    attackable : { type : Boolean, required : true },
    defensible : { type : Boolean, required : true },
    destroyStatus  : { type : Boolean, required : true },
    level  : { type : Number, required : true },
    suspicionCount : { type : Number, required : true },   
    attackProgress : { type : Array, required : true },
    attackSenarioProgress : { type : Array, required : true },
    defenseProgress : { type : Array, required : true },
    beActivated : { type : Array, required : true },   
    defenseActive : { type : Array, required : true },
    defenseLv : { type : Array, required : true },
    defenseCnt : { type : Array, required : true },
    attackConn   : { type : {}, required : true },
})

module.exports = mongoose.model('Section', Section); 