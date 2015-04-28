var express = require('express');
var bodyParser = require('body-parser');
var multer = require('multer'); 
var request = require("request");
var pg = require('pg');
var jsonwebtoken = require("jsonwebtoken");
var hash = require('password-hash'); // Importance Note: will try to use bcrypt later.
var _ = require('lodash');

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);


/* this is list of const for config using in the app*/
const conString = "postgres://postgres:password@localhost/NEX";
const google_api_key = "AIzaSyAArUeU1n8FB8ZqxRLyRCL-DivL0aY4ses";
const jwt_secret = "hihihi"; // Need to be VERY SECRET. 
const pn_publish_key = "pub-c-7b8f064f-cc65-4656-8d63-d6760bb6e0fe";
const pn_subcribe_key = "sub-c-abe025b6-b042-11e4-85c1-02ee2ddab7fe";



/* this is init() for server running */
var pubnub = require("pubnub")({
    ssl           : true,  // <- enable TLS Tunneling over TCP 
    publish_key   : pn_publish_key,
    subscribe_key : pn_subcribe_key
});

app.set('port', (process.env.PORT || 5000));
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json({strict: false})); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(multer()); // for parsing multipart/form-data

app.all('/', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With");
  next();
 });

 app.use(express.static('public'));
 
 
///////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////

/****** signinup *********
 This is to register account if not exist or login if already exist
 1. input: email, pass, uuid
 2. output: all about this user.
 - default radar
 - list of favourite radar 
 ****************/
 app.get('/signinup', function(req, res) {
	console.log("GET request //signinup");
	var email = req.query.email, password = req.query.password, uuid = req.query.uuid;
	
	// check user/pass valid
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.');
			return true;
		};
	
		if(handleError(err)) return;
		
		client.query('SELECT "_id","password" from "User" WHERE email like \''+email+'\'', function(err, result) {
			if(handleError(err)) return;
		
			if(result.rows.length > 0) { // SIGN IN. check password. 
				var hash_password = hash.generate(password);
				done();
				if(hash.verify(password, result.rows[0].password)) { // sign in success. return token.
					var token = jsonwebtoken.sign({ _id: result.rows[0]._id }, jwt_secret);
					res.jsonp({retcod: 0, token : token});
				} else {	// sign in false. return 403 error. 
					res.jsonp({retcod: -1});
				}
			} else { // there is no record for this user, SIGN UP then login by return token
				var hash_password = hash.generate(password);
				client.query('INSERT INTO "User"(email, password) VALUES(\''+email+'\', \''+hash_password+'\') RETURNING _id', function(err, result) {
					if(handleError(err)) return;
					
					done();
					console.log('Success Create new Account: \''+email+'\'');

					var token = jsonwebtoken.sign({ _id: result.rows[0]._id }, jwt_secret);
					console.log("SUCCESS token = " + token);
					res.jsonp({retcod: 0, token : token});

					client.end();
				});
			}
			client.end();
		
	  });
	});
});
 
app.post('/signup_basic', function(req, res){
    console.log(req.body) // form fields
    console.log(req.files) // form files
    res.status(204).end()
});

app.post('/signup_detail', function(req, res){
    console.log(req.body) // form fields
    console.log(req.files) // form files
    res.status(204).end()
});

app.post('/signup_contact', function(req, res){
    console.log(req.body) // form fields
    console.log(req.files) // form files
    res.status(204).end()
});

app.post('/signup_others', function(req, res){
    console.log(req.body) // form fields
    console.log(req.files) // form files
    res.status(204).end()
});
 /****** Initiative *********
 This is for Init session between client & server. 
 1. input: token, uuid
 2. output: return all info for this user.
 - list of favourite radar & home radar.
 - example: {retcod, 0, fav_list : [fav_id,...]}
 
 return false mean not register.
 ****************/
 app.get('/init', function(req, res) { // currently do same as init_radar_here
	console.log("GET request //init");
	var token = req.query.token;
	
	var user_id = jsonwebtoken.decode(token)._id;
	
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.');
			return true;
		};
		
		if(handleError(err)) return;
		
		client.query('SELECT DISTINCT  "_id",fav_name from "UserFavourite" WHERE _user_id = \''+user_id+'\'', function(err, result) {
			if(handleError(err)) return;
			
			done();
			var fav_list = [];
			var i = 0;
			while( i < result.rows.length) {
				var temp = {};
				temp.id = result.rows[i]._id;
				temp.n = result.rows[i].fav_name;
				fav_list.push(temp);
				i++;
			}
			client.end();
			res.jsonp({retcod: 0, fav_list : fav_list});
		});
		
	});
});


/////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////

/*** Radar get channels API.  ****
Radar: Here, Favourite, WorldMap (Post Tracker), PageTracker, GroupTracker, EventTracker (database search)...
**********************************/ 

/********************************
// init_radar_here
1. input: 
	token: to verify the user_id
	loc,lat: to get from googlemap or database about the list of channels
	types (optional): type of radar (if not defined, it will get Most important ranking location around this point)
2. outputs format: { channels: [place_id, place_id]}
3. process: 
	- query google map to get list of place_id nearby
	- process place_id to channel_id
	- if list than 20 place_id, increase radius to 5times. and search again.
**********************************/
app.get('/init_radar_here', function(req, res) {
	var token = req.query.token;
	var lon = req.query.lon, lat = req.query.lat, types = req.query.types;
	
	var google_map_api_url;
	console.log("GET \\init_radar_here?token="+token+"&lon=" + lon + "&lat=" + lat + "&types=" + types);

	if(typeof types != 'undefined') {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+lon + "," + lat + "&rankby=distance&type=" + types + "&key=" + google_api_key;
	} else {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+lon + "," + lat + "&radius=1000&key=" + google_api_key
	}
	
	console.log(google_map_api_url);
	request({
		uri: google_map_api_url,
		method: "GET",
		timeout: 10000
		}, function(error, response, body) {
			var google_places_here = JSON.parse(body);
			var len = google_places_here.results.length;
			var MAX_CHANNEL_NUMBER = (typeof types != 'undefined')? 5 : 10;
			var array_channels=[];
			var i = 0;

			while(i < len && i < MAX_CHANNEL_NUMBER) {
				array_channels.push(google_places_here.results[i].place_id);
				i++;
			}

			res.jsonp({retcod: 0, channels: array_channels});
	});
});

/********************************
init_radar_fovourite
1. input: 
	token, 
	favourite_location_id
2. outputs: var channels = [place_id, place_id]
	ex: {retcod: 0, channels: [ch1,ch2,ch3...]}
3. process: 
	- query database to get place_ids of this favourite_location_id
**********************************/
app.get('/init_radar_fovourite', function(req, res) {
	var channels = [];
	console.log("GET \\init_radar_fovourite?favourite_location_id" + req.query.favourite_location_id);
	var token = req.query.token, id = req.query.id;
	
	var user_id = jsonwebtoken.decode(token)._id;
	
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.');
			return true;
		};
		
		if(handleError(err)) return;
		
		client.query('SELECT channels from "UserFavourite" WHERE _user_id = \''+user_id+'\' AND _id = \''+id+'\'', function(err, result) {
			if(handleError(err)) return;
			
			done();
			console.log(result);
			var array_channels=[];
			var i = 0, len = result.rows[0].channels.length;
			while(i < len ) {
				array_channels.push(result.rows[0].channels[i]);
				i++;
			}
			
			res.jsonp({retcod: 0, channels: array_channels});
			client.end();
			
		});
		
	});
});

/********************************
// init_radar_world
1. input: token, loc,lat
2. outputs: [place_id, place_id]
	- placename
	- list of channels for this place. 
3. process: 

**********************************/
app.get('/init_radar_world', function(req, res) {
	var channels = [];
	var token = req.query.token;
	var lon = req.query.lon, lat = req.query.lat;
	var google_map_api_url;
	console.log("GET \\init_radar_world?lon=" + lon + "&lat=" + lat);
	
	if(typeof types != 'undefined') {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+lat + "," + lon + "&rankby=distance&type=" + types + "&key=" + google_api_key;
	} else {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+lat + "," + lon + "&radius=1000&key=" + google_api_key
	}
	
	request({
		uri: google_map_api_url,
		method: "GET",
		timeout: 10000
		}, function(error, response, body) {
			var google_places_here = JSON.parse(body);
			var len = google_places_here.results.length;
			var MAX_CHANNEL_NUMBER = 10;
			var array_channels=[];
			var i = 0;

			while(i < len && i < MAX_CHANNEL_NUMBER) {
				array_channels.push(google_places_here.results[i].place_id);
				i++;
			}

			res.jsonp({ mychannel: array_channels});
	});
});

/*** POST listener.  ****
create_post
create_radar_favourite
add_post_like
add_post_comment
add_post_relay
add_commnet_comment
add_comment_like
remove_post_like
remove_post_comment
remove_post_relay
remove_commnet_comment
remove_comment_like
**********************************/ 

/******************* 
POST post at Here radar. If it at other radar, cannot create POST. only at Home. 
input: token, channels, title, content, policy... 
output: success/fails

process:
1. insert new record (title, content, channels) to database
2. get back post_id, expired
3. PUBLISH to 'channel' with message = {new : {type= info|news, content={_id, title, expired...}}}
********************/
app.post('/create_post', function(req, res) {
	var message = req.body;
	
	var channels = [message.Channels], content = (typeof message.Content != 'undefined') ? message.Content : "", token = message.Token;
	var user_id = jsonwebtoken.decode(token)._id;
	console.log("POST request /create_post, body = ", JSON.stringify(req.body));
	
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;
			console.log(err);
			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
	
		if(handleError(err)) return;
		
		/*var array_channel = "{";
		var i=0;
		while(i < channels.length - 1) {
			array_channel += "\""+channels[i]+"\",";
			i++;
		}
		array_channel += "\""+channels[i]+"\"}";*/
		
		var array_channel = "{"+channels+"}";
		console.log('INSERT INTO "Post"( content, _user_id, expired_duration, channels) VALUES(\''+ content +'\','+user_id+', 5*60, \''+array_channel+'\' ) RETURNING _id, expired_duration, (select nickname, avatar from "User" where _id like "'+user_id+'")');
		client.query('INSERT INTO "Post"( content, _user_id, expired_duration, channels) VALUES(\''+ content +'\','+user_id+', 5*60, \''+array_channel+'\' ) RETURNING _id, create_time, (select nickname from "User" where _id = '+user_id+'), (select avatar from "User" where _id = '+user_id+')', function(err, result) {
			if(handleError(err)) return;
			
			// var id = result.rows[0]._id, expired_duration = result.rows[0].expired_duration;
			// var user_nickname = result.rows[0].nickname, user_avatar = result.rows[0].avatar;
			// done();
			// var i=0;
			// while(i < channels.length) {
				// pubnub.publish({ 
					// channel   : channels[i],
					// message   : {"new":true,"type":1,"id":id,"owner":{"id":user_id,"avatar":user_avatar,"name":user_nickname},"body":{"content": content,"create_time":"12/23/2014 10:10:10","last_time":"12/23/2014 10:10:10","expired_time":"12/23/2014 10:10:10","i":{"cmt":0,"lk":0,"rly":0}}},
					// callback  : function(e) { console.log( "SUCCESS!", e ); },
					// error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
				// });				
				// i++;
			// }

					
			var id = result.rows[0]._id, create_time = result.rows[0].create_time;
			var user_nickname = result.rows[0].nickname, user_avatar = result.rows[0].avatar;
			var channel = channels[0];	
			
			client.query('INSERT INTO "Relay"(_id,_entity_id, _user_id, channel ) VALUES((select coalesce(MAX(_id),0) FROM "Relay" where _entity_id = '+id+') + 1,\''+ id +'\',\''+ user_id +'\', \''+channel+'\')', function(err, result) {
				if(handleError(err)) return;

				done();
				var i=0;
						
				var temp = {"new" : true, "type" : 1};					
				temp.id = id;
				temp.owner = {};
				temp.owner.id = user_id;
				temp.owner.name = user_nickname;
				temp.owner.avatar = user_avatar;
				temp.content = content;
				temp.metadata = {};
				temp.metadata.create_time = create_time;
				temp.i = {};
				temp.i.l = 0;
				temp.i.c = 0;
				temp.i.r = 0;
						
						
				while(i < channels.length) {
					var no_c = no_l = no_r = 0;
					pubnub.publish({ 
						channel   : channels[i],
						message   : temp,
						callback  : function(e) { console.log( "SUCCESS!", e ); },
						error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
					});				
					i++;
				}

				res.jsonp({retcode: 0});
				client.end();
			});
			
			client.end();
			
		});
	});

});


/******************* 
POST create_radar_favourite
input; token, channels[], name, geoloc. 
outpout: success.
process:
1. insert all the channels (MAXIMUM is 5 for now) into database
2. then if name is home. create channels for home. this is only use if 
- radar here check that you are at home.
- or using favourit radar home. 
********************/
app.post('/add_radar_favourite', function(req, res) {
	var message = req.body;
	console.log(message);
	var token = message.Token;
	var user_id = jsonwebtoken.decode(token)._id;
	
	var name = message.Name, channels = message.Channels, geoloc =  { lat : message.lat, lon : message.lon};
	
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
		
		if(handleError(err)) return;
		
		var i=0;
		var array_channel = "{";
		var MAX_CHANNEL_NUMBER = 5;
		while(i <channels.length - 1  && i < MAX_CHANNEL_NUMBER) {
			array_channel += "\""+channels[i]+"\",";
			i++;
		}
		array_channel += "\""+channels[i]+"\"}";
		console.log('INSERT INTO "UserFavourite"(_user_id, fav_name, channels) VALUES(\''+ user_id +'\',\''+ name +'\',\''+ array_channel +'\') RETURNING _id');
		client.query('INSERT INTO "UserFavourite"(_user_id, fav_name, channels) VALUES(\''+ user_id +'\',\''+ name +'\',\''+ array_channel +'\') RETURNING _id, fav_name', function(err, result) {
			if(handleError(err)) return;
			
			var id = result.rows[0]._id;
			var name = result.rows[0].fav_name;
			done();
			res.jsonp({retcode: 0, fav : {id : id, n : name}});
			client.end();
		});
	});	
});


/******************* 
POST create_post_like
input: 
- token
- post_id
process:
1. insert todatbase.
2. publish about the update. to all channels of this post. 
********************/
app.post('/create_post_like', function(req, res) {
	var message = req.body;
	console.log(message);
	
	var token = message.Token, id = message.id;
	var user_id = jsonwebtoken.decode(token)._id;

	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			console.log(err);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
		
		if(handleError(err)) return;

		client.query('INSERT INTO "Like"(_id,_entity_id, _user_id ) VALUES((select coalesce(MAX(_id),0) FROM "Like" where _entity_id = '+id+') + 1,\''+ id +'\',\''+ user_id +'\') RETURNING (select array_accum( distinct channel) channels from "Relay" where _entity_id = '+id+' ), (select count(_id) no_like from "Like" where _entity_id = '+id+')', function(err, result) {
			if(handleError(err)) return;
			
			var no_like = result.rows[0].no_like, channels = result.rows[0].channels;
			done();
			var i=0;
			console.log('channels('+channels.length+') : ' + channels);
			if(no_like == 10 || no_like == 99) { // this is to control the broadcast of no_like <-- need to think about it again.
				while(i < channels.length) {
					pubnub.publish({ 
						channel   : channels[i],
						message   : {"new":false,"type":1,"id":id,"i":{"lk":no_like}},
						callback  : function(e) { console.log( "SUCCESS!", e ); },
						error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
					});				
					i++;
				}	
			} else {
				console.log('Wait until 10 like to broadcast');
			}			
			res.jsonp({retcode: 0});
			client.end();
		});
	});	
});


/******************* 
POST create_post_like
input: 
- token
- post_id
- comment content
process:
1. insert todatbase.
2. publish about the update. to all channels of this post. 
********************/
app.post('/create_post_comment', function(req, res) {
	var message = req.body;
	console.log(message);
	
	var token = message.Token, id = message.id, content = message.content;
	var user_id = jsonwebtoken.decode(token)._id;

	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			console.log(err);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
		
		if(handleError(err)) return;

		client.query('INSERT INTO "Comment"(_id,_entity_id, _user_id, content ) VALUES((select coalesce(MAX(_id),0) FROM "Comment" where _entity_id = '+id+') + 1,\''+ id +'\',\''+ user_id +'\', \''+content+'\') RETURNING (select array_accum( distinct channel) channels from "Relay" where _entity_id = '+id+' ), (select count(_id) no_comment from "Comment" where _entity_id = '+id+')', function(err, result) {
			if(handleError(err)) return;
			
			var no_comment = result.rows[0].no_comment, channels = result.rows[0].channels;
			done();
			var i=0;
			console.log('channels('+channels.length+') : ' + channels);
			if(no_comment == 10 || no_comment == 99) { // this is to control the broadcast of comment <-- need to think about it again.
				while(i < channels.length) {
					pubnub.publish({ 
						channel   : channels[i],
						message   : {"new":false,"type":1,"id":id,"i":{"c":no_comment}},
						callback  : function(e) { console.log( "SUCCESS!", e ); },
						error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
					});				
					i++;
				}
			} else {
				console.log('Wait until 10 comments to broadcast');
			}
			res.jsonp({retcode: 0});
			client.end();
		});
	});	
});

/******************* 
POST create_post_relay
input:
- token
- post id. 
process:
1.update database
 - insert to relay table.
 - update post table about new channel if have. 
2. calculate new expire. 
3. pub about the update. to "new" channel of this post. 
********************/
app.post('/create_post_relay', function(req, res) {
	var message = req.body;
	console.log(message);
	
	var token = message.Token, id = message.id, channel = message.channel;
	var user_id = jsonwebtoken.decode(token)._id;

	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			console.log(err);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
		
		if(handleError(err)) return;

		client.query('INSERT INTO "Relay"(_id,_entity_id, _user_id, channel ) VALUES((select coalesce(MAX(_id),0) FROM "Relay" where _entity_id = '+id+') + 1,\''+ id +'\',\''+ user_id +'\', \''+channel+'\') RETURNING (select count(_id) count_channel from "Relay" where _entity_id = '+id+' AND channel like \''+channel+'\'), (select array_accum( distinct channel) channels from "Relay" where _entity_id = '+id+' ), (select count(_id) no_relay from "Relay" where _entity_id = '+id+')', function(err, result) {
			if(handleError(err)) return;
			
			var no_relay = result.rows[0].no_realy, channels = result.rows[0].channels, count_channel = result.rows[0].count_channel;
			done();
			var i=0;
			console.log('channels('+channels.length+') : ' + channels);
			if(no_relay == 10 || no_relay == 99) { // this is to control the broadcast of no_relay <-- need to think about it again.
				while(i < channels.length) {
					pubnub.publish({ 
						channel   : channels[i],
						message   : {"new":false,"type":1,"id":id,"i":{"r":no_relay}},
						callback  : function(e) { console.log( "SUCCESS!", e ); },
						error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
					});				
					i++;
				}			
			}
			
			client.end();
			
			if(count_channel == 1){
				console.log('Yes, it is first time this Post['+id+'] appear in channel = '+channel+'. Broadcast it');
				client.query('SELECT p._id pid, u._id uid, u.nickname, u.avatar, p.content, p.create_time, p.n_view,(select count(c._id) from "Comment" c where c._entity_id = p._id) as no_comment, (select count(l._id) from "Like" l where l._entity_id = p._id) as no_like, (select count(r._id) from "Relay" r where r._entity_id = p._id) as no_relay FROM "Post" p,"User" u WHERE  p._user_id = u._id AND p._id = '+id+')', function(err, result) {
					if(handleError(err)) return;
					
					done();
					var i = 0;					
					var temp = {"new" : true, "type" : 1};	
					if( i < result.rows.length) {	
										
						temp.id = result.rows[i].pid;
						temp.owner = {};
						temp.owner.id = result.rows[i].uid;
						temp.owner.name = result.rows[i].nickname;
						temp.owner.avatar = result.rows[i].avatar;
						temp.content = result.rows[i].content;
						temp.metadata = {};
						temp.metadata.create_time = result.rows[i].create_time;
						temp.i = {};
						temp.i.l = parseInt(result.rows[i].no_like);
						temp.i.c = parseInt(result.rows[i].no_comment);
						temp.i.r = parseInt(result.rows[i].no_relay - 1);
					} 
					
					client.end();
				});
				
				pubnub.publish({ 
					channel   : channel,
					message   : temp,
					callback  : function(e) { console.log( "SUCCESS!", e ); },
					error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
				});	
			} 
			
			res.jsonp({retcode: 0});
			
		});
	});	
});


app.post('/create_comment_comment', function(request, response) { // no need broadcast
});


app.post('/create_comment_like', function(request, response) { // no need broadcast. 

});



app.post('/remove_post_like', function(request, response) {

});

app.post('/remove_post_comment', function(request, response) {

});

app.post('/remove_comment_comment', function(request, response) {

});

app.post('/remove_comment_like', function(request, response) {

});

/******************* 
POST chatroom (for group|event) 
input: name, desc, event_datetime(option), event_duration(option), geolocation(lon, lat) (to calculate channels), address (option if from client can get address from google decode), policy
process: 
- get location
- then, get channels
- then, insert into ChatRoom
- then, pulish to all those channels around. 
***: 
output: event_channel
- then publish the info about the chatroom. click into this will goto chatroom. 
********************/
app.post('/create_chatroom', function(req, res) {
	var message = req.body;
	
	var geoloc = { lat : message.lat, lon : message.lon} , name = message.name, desc = (typeof message.desc != 'undefined') ? message.desc : "";
	var event_datetime = message.event_datetime, event_duration = message.event_duration, address = message.address, policy = message.policy;
	var is_event = (typeof event_datetime != 'undefined' && typeof event_duration  != 'undefined') ? true : false;
	console.log("POST request /create_chatroom");

	var google_map_api_url;
	if(typeof types != 'undefined') {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+geoloc.lat + "," + geoloc.lon + "&rankby=distance&type=" + types + "&key=" + google_api_key;
	} else {
		google_map_api_url= "https://maps.googleapis.com/maps/api/place/nearbysearch/json?location="+geoloc.lat + "," + geoloc.lon + "&radius=1000&key=" + google_api_key
	}
	
	request({
			uri: google_map_api_url,
			method: "GET",
			timeout: 10000
		}, function(error, response, body) {
			var google_places_here = JSON.parse(body);
			var len = google_places_here.results.length;
			var MAX_CHANNEL_NUMBER = 3;
			var channels = [];
			var array_channel = "{";
			var i=0;
			while(i < google_places_here.results.length - 1  && i < MAX_CHANNEL_NUMBER) {
				array_channel += "\""+google_places_here.results[i].place_id+"\",";
				channels.push(google_places_here.results[i].place_id);
				i++;
			}
			array_channel += "\""+google_places_here.results[i].place_id+"\"}";
			channels.push(google_places_here.results[i].place_id);
			
			var query = "";
			if(typeof event_datetime != 'undefined'  &&  typeof event_duration != 'undefined' ) {
				query = 'INSERT INTO "ChatRoom"(room_name, room_desc, , expired_time, channels) VALUES(\''+ name +'\', \''+ desc +'\', now() + interval \'23 hours\', \''+array_channel+'\') RETURNING _id, expired_time';
			} else {
				query = 'INSERT INTO "ChatRoom"(room_name, room_desc, expired_time, channels) VALUES(\''+ name +'\', \''+ desc +'\', now() + interval \'23 hours\', \''+array_channel+'\') RETURNING _id, expired_time';
			}
			
			pg.connect(conString,function(err, client, done) {
				var handleError = function(err) {
					// no error occurred, continue with the request
					if(!err) return false;

					done(client);
					res.writeHead(500, {'content-type': 'text/plain'});
					res.end('Internal Error happen.' + err);
					return true;
				};

				if(handleError(err)) return;
				client.query(query, function(err, result) {
					if(handleError(err)) return;
					
					var id = result.rows[0]._id, expired_time = result.rows[0].expired_time;
					done();
					var i=0;
					while(i < channels.length) {
						pubnub.publish({ 
							channel   : channels[i],
							message   : {new : {id : id, type : (typeof is_event == true)? 'event' : 'group', content : { id : id, exp : expired_time}}},
							callback  : function(e) { console.log( "SUCCESS!", e ); },
							error     : function(e) { console.log( "FAILED! RETRY PUBLISH!", e ); }
						});				
						i++;
					}
					
					res.jsonp({ type: true});
					client.end();
				});			
			});
		});
});


/*** GET listener.  ****
get_post_list: to get the latest post of the radar (channels)
get_post_detail
get_post_comments
get_comment_detail
get_post_likes (only for owner)
get_post_relays (only for owner)
**********************************/ 
app.get('/get_post_list', function(req, res) {
	var token = req.query.token;
	var channels = req.query.channels, page = req.query.page;
	
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;
			
			console.log(err);
			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
	
		if(handleError(err)) return;
		
		var channels_condition = ' channel like \''+channels[0]+'\'';
		for(var i = 1; i < channels.length; i ++) {
			channels_condition+=' OR' + ' channel like \''+channels[i]+'\'';
		}
		console.log('SELECT p._id pid, u._id uid, u.nickname, u.avatar, p.content, p.create_time, p.n_view,(select count(c._id) from "Comment" c where c._entity_id = p._id) as no_comment, (select count(l._id) from "Like" l where l._entity_id = p._id) as no_like, (select count(r._id) from "Relay" r where r._entity_id = p._id) as no_relay FROM "Post" p,"User" u WHERE  p._user_id = u._id AND p._id IN (SELECT distinct _entity_id FROM "Relay" WHERE' + channels_condition + ')');
		client.query('SELECT p._id pid, u._id uid, u.nickname, u.avatar, p.content, p.create_time, p.n_view,(select count(c._id) from "Comment" c where c._entity_id = p._id) as no_comment, (select count(l._id) from "Like" l where l._entity_id = p._id) as no_like, (select count(r._id) from "Relay" r where r._entity_id = p._id) as no_relay FROM "Post" p,"User" u WHERE  p._user_id = u._id AND p._id IN (SELECT distinct _entity_id FROM "Relay" WHERE' + channels_condition + ')', function(err, result) {
			if(handleError(err)) return;
			
			done();
			var i = 0;
			var post_list = [];
			while( i < result.rows.length) {
				var temp = {"new" : true, "type" : 1};
				temp.id = result.rows[i].pid;
				temp.owner = {};
				temp.owner.id = result.rows[i].uid;
				temp.owner.name = result.rows[i].nickname;
				temp.owner.avatar = result.rows[i].avatar;
				temp.content = result.rows[i].content;
				temp.metadata = {};
				temp.metadata.create_time = result.rows[i].create_time;
				temp.i = {};
				temp.i.l = parseInt(result.rows[i].no_like);
				temp.i.c = parseInt(result.rows[i].no_comment);
				temp.i.r = parseInt(result.rows[i].no_relay - 1);
				post_list.push(temp);
				i++;
			} 
			res.jsonp({retcode: 0, posts : post_list});
			
			client.end();
		});
		
	});

});

/********************************
// get_post_detail
1. input: token, id of post
2. outputs: title, content, comments, likes,...
	- placename
	- list of channels for this place. 
3. process: 

**********************************/
app.get('/get_post_detail', function(req, res) {
	var token = req.query.token;
	var id = req.query.id;
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
	
		if(handleError(err)) return;
		console.log('SELECT p._id pid, u._id uid, u.nickname, p.content, p.create_time, p.n_view,(select count(c._id) from "Comment" c where c._entity_id = p._id) as no_comment, (select count(l._id) from "Like" l where l._entity_id = p._id) as no_like, (select count(r._id) from "Relay" r where r._entity_id = p._id) as no_relay FROM "Post" p,"User" u WHERE p._id = \''+id+'\' AND p._user_id = u._id');
		client.query('SELECT p._id pid, u._id uid, u.nickname, u.avatar, p.content, p.create_time, p.n_view,(select count(c._id) from "Comment" c where c._entity_id = p._id) as no_comment, (select count(l._id) from "Like" l where l._entity_id = p._id) as no_like, (select count(r._id) from "Relay" r where r._entity_id = p._id) as no_relay FROM "Post" p,"User" u WHERE p._id = \''+id+'\' AND p._user_id = u._id', function(err, result) {
			if(handleError(err)) return;
			
			done();
			var i = 0;
			if( 0 < result.rows.length) {
				var temp = {"new" : true, "type" : 1};
				temp.id = result.rows[i].pid;
				temp.owner = {};
				temp.owner.id = result.rows[i].uid;
				temp.owner.name = result.rows[i].nickname;
				temp.owner.avatar = result.rows[i].avatar;
				temp.content = result.rows[i].content;
				temp.metadata = {};
				temp.metadata.create_time = result.rows[i].create_time;
				temp.i = {};
				temp.i.l = parseInt(result.rows[i].no_like);
				temp.i.c = parseInt(result.rows[i].no_comment);
				temp.i.r = parseInt(result.rows[i].no_relay - 1);
				
				res.jsonp({retcode: 0, post_detail : temp});
			} else {
				res.jsonp({retcode: -1});
			}
			client.end();
			
		});
	});
});

/********************************
// get_post_comment_list
1. input: token, id of post
2. outputs: title, content, comments, likes,...
	- placename
	- list of channels for this place. 
3. process: 

**********************************/
app.get('/get_post_comment_list', function(req, res) {
	var token = req.query.token;
	var id = req.query.id;
	pg.connect(conString,function(err, client, done) {	
		var handleError = function(err) {
			// no error occurred, continue with the request
			if(!err) return false;

			done(client);
			res.writeHead(500, {'content-type': 'text/plain'});
			res.end('Internal Error happen.' + err);
			return true;
		};
		
		if(handleError(err)) return;
		client.query('SELECT c._id, c.content, c.create_time, u._id as uid, u.nickname, u.avatar , coalesce(array_length(c.likes,1),0) no_like  FROM "Comment" c JOIN "User" u ON (c._user_id = u._id) WHERE _entity_id = ' + id, function(err, result) {
			if(handleError(err)) return;
			
			done();
			var comment_list = [];
			var i = 0;
			while( i < result.rows.length) {
				var temp = {};
				temp.id = result.rows[i]._id;
				temp.owner = {};
				temp.owner.id = result.rows[i].uid;
				temp.owner.name = result.rows[i].nickname;
				temp.owner.avatar = result.rows[i].avatar;
				temp.content = result.rows[i].content;
				temp.metadata = {};
				temp.metadata.create_time = result.rows[i].create_time;
				temp.i = {};
				temp.i.l = result.rows[i].no_like;
				
				comment_list.push(temp);
				i++;
			} 
			
			res.jsonp({retcode: 0, comments : comment_list});
			client.end();
			
		});
	});
});

/********************************
// get_post_comment_comment
1. input: token, id of post
2. outputs: title, content, comments, likes,...
	- placename
	- list of channels for this place. 
3. process: 

**********************************/
app.get('/get_post_comment_comment', function(req, res) {

});

/////////////////////////////////////////////////////////////////////////////

/******************* 
POST join request to chatroom(event, group) 
input; token, channels[], name, geoloc. 
outpout: success.
process:
1. check policy
2. if wait for accept, then return waiting for notification. 
3. if auto accept, then insert into table user-chatroom. then return list of post for that chatroom. 
********************/
app.post('/join_chatroom', function(request, response) {

});





////////////////////////////////////////////////////////////////////

app.get('/test', function(reg, res) {
	try{
	io.to(reg.query.id).emit('message', reg.query.msg);
	res.jsonp({retcode: 0});
	} catch (e) {
		console.log(e);
		res.jsonp({retcode: 1});
	}
});

var _notify = function() {
	var map = {};
	
	function push(userid, socketid) {
		console.log('_notify.map push('+userid+','+socketid+')');
		if(userid in map) { // already exist
			map[userid].push(socketid);
		} else {
			map[userid] = [];
			map[userid].push(socketid);
		}
	}
	
	function remove(userid, socketid) {
		console.log('_notify.map remove('+userid+','+socketid+')');
		if((userid in map) && map[userid].length > 1) {
			var index = map[userid].indexOf(socketid);
			map[userid].splice(index, 1);
		} else{
			delete map[userid];
		}
	}
	
	function emit(userid, message) {
		console.log('_notify.map emit('+userid+','+message+') length ' + map[userid].length);
		for(i in map[userid]) {
			io.to(map[userid][i]).emit('message', message);
		}
	}
	
	return  {
		emit : emit,
		push : push,
		remove : remove
	}	
}();

io.on('connection', function(socket){
  console.log('a user connected' + socket.id);
	var user_id;
  socket.on('init', function(msg) {
	user_id = jsonwebtoken.decode(msg)._id;
	console.log('this user is ' + user_id + ' for socket id = ' + socket.id);
	_notify.push(user_id, socket.id);
	
	pubnub.subscribe({
		channel: user_id,
		message: function(m){ 
			console.log('we will emit to user id = ' + user_id);
			_notify.emit(user_id, m)
		},
		error: function (error) {
		  // Handle error here
		  console.log(JSON.stringify(error));
		}
	});
	
  });
  
  socket.on('disconnect', function(){
	_notify.remove(user_id, socket.id);
    console.log('user disconnected');
  });
  
});

http.listen(app.get('port'), function() {
  console.log("Node app is running at localhost:" + app.get('port'));
});
