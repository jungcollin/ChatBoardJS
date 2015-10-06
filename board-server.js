function atob(str) {
    return new Buffer(str, 'base64').toString('binary');
}

function makeid()
{
	var text = "";
	var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

	for( var i=0; i < 24; i++ )
		text += possible.charAt(Math.floor(Math.random() * possible.length));

	return text;
}

function Board(boardname) {
	var id = makeid();
	var name = boardname;
	var messages = [];
	var objects = {};
	var users = {};
	var images = {};

	var commands = [ 'chat', 'path', 'line', 'ellipse', 'rectangle', 'point', 'move', 'scale', 'remove', 'image', 'text', 'transform' ];

	function getImage(imgid) {
		return images[imgid];
	}

	var commandPreProcessor = {
		'chat' : function(user, data) {
			data.from = user.name;
			return data;
		},
		'image' : function(user, data) {
			if(data.href.substring(0,5) == 'data:') {
				var imgid = makeid();
				var regex = /^data:.(.+);base64,(.*)$/;
				var matches = data.href.match(regex);
				images[imgid] = {
					contentType : matches[1],
					data: atob(matches[2])
				};
				data.href = '/images/?board=' + id + '&img=' + imgid;
				console.log("Saved image: " + data.href);
			}
			return data;
		}
	}
    
    function handleObject(data) {
		objects[data.id] = data;
    }

	var commandHandlers = {
		'chat' : function(data) {
			messages.push(data)
		},
		'path' : handleObject,
		'line' : handleObject,
		'ellipse' : handleObject,
		'rectangle' : handleObject,
		'image' : handleObject,
		'text'  : handleObject,
		'point' : function(data) {
			objects[data.id].points = objects[data.id].points || [];
			objects[data.id].points.push(data.point);
		},
		'move'  : function(data) {
			if (Array.isArray(data.id)) {
				for (var i = 0; i < data.id.length; i++) {
					var offset = objects[data.id[i]].offset;
					if (offset) {
						offset.x += data.x;
						offset.y += data.y;
					}
				}
			} else {
				var offset = objects[data.id].offset;
				if (offset) {
					offset.x += data.x;
					offset.y += data.y;
				}
			}
		},
		'scale' : function(data) {
			var scale = objects[data.id].scale;
            if(scale) {
				scale.x = data.x;
				scale.y = data.y;
            }
		},
		'transform'  : function(data) {
			var object = objects[data.id];
            if(object.scale && data.scale) {
				object.scale.x = data.scale.x;
				object.scale.y = data.scale.y;
            }
            if(object.offset && data.offset) {
                object.offset.x = data.offset.x;
                object.offset.y = data.offset.y;
            }
		},
		'remove' : function(data) {
			if(objects[data.id].type == 'image') {
				var matchid = objects[data.id].href.match(/\/images\/\?board=[A-Za-z0-9]+&img=([A-Za-z0-9]+)/);
				if(matchid && matchid.index >= 0) {
					imgid = matchid[1]; 
					delete images[imgid]
					console.log("Removed image: " + objects[data.id].href); 
				}
			}
			delete objects[data.id];
		}
	}

	function broadcast(command, data, socket) {
		for(var key in users) {
			if(users[key].socket != socket)
			{
				users[key].socket.emit(command, data);
			}
		}
	}
	
	function register(user, command) {
		user.socket.on(command, function (data) {
			if (commandPreProcessor[command]) {
				data = commandPreProcessor[command](user, data)
			}

			if(commandHandlers[command]) {
				commandHandlers[command](data);
			}

			broadcast(command, data, user.socket);
		});
	}
	

	function getUserDetails(user){
		return {
			id: user.id,
			name: user.name, 
			email: user.email, 
			facebookId: user.facebookId  
		}
	}

	function User(data, socket) {
		return {
			id: makeid(),
			name: data.name, 
			email: data.email, 
			facebookId: data.facebookId,
			socket: socket
		}
	}
	
	
	function rejoin(socket, sessionId) {
		
		for(var key in users) {
			var user = users[key];
			
			if(user.id == sessionId) {
				user.socket = socket;

				console.log(socket.id + " rejoins board: " + name + " as " + user.name);

				for(var j = 0; j < commands.length; j++)
				{
					register(user, commands[j]);
				}

				socket.emit('welcome', getUserDetails(user));

				broadcast('joined', getUserDetails(user), socket);

				socket.emit('replay', { 
					objects: objects, 
					messages: messages, 
					users: getUsers() 
				});
				
				return;
			}
		}

		socket.emit('joinerror', { message: 'Invalid session' });
	}

    function getUsers() {
        var userlist = [];
        for(var key in users)
        {
			var user = users[key];
            userlist.push(getUserDetails(user));
        }
        return userlist;
    }

	function isNotUndefinedOrNull(value){
		return value !== undefined && value !== null
	}

	function isNotEmptyString(value){
		return value !== "";
	}
	
	function userExists(data) {
		if(users[data.id] !== undefined && users[data.id] !== null) return true;
		for(var key in users) {
			if(isNotUndefinedOrNull(users[key].facebookId) && users[key].facebookId === data.facebookId) return true;
			if(isNotUndefinedOrNull(users[key].email) && isNotEmptyString(users[key].email) && users[key].email === data.email) return true;
		}
		return false;
	}

	function join(socket, data) {
		if(!data.name || data.name.length == 0) {
			socket.emit('joinerror', { message: 'You need to enter a name to join' });
			return;
		}

		if(!userExists(data)) {
			var newUser = new User(data, socket); 
			
			users[newUser.id] = newUser;

			console.log(socket.id + " joins board: " + name);

			// attach all message handlers to this socket
			for(var j = 0; j < commands.length; j++)
			{
				register(newUser, commands[j]);
			}

			socket.emit('welcome', getUserDetails(newUser));

			broadcast('joined', getUserDetails(newUser), socket);

			socket.emit('replay', { 
				objects: objects, 
				messages: messages, 
				users: getUsers() 
			});

			socket.on('disconnect', function() {
				console.log(newUser.name + ' has left the building');
				broadcast('left', { id: newUser.id, name: newUser.name }, socket);
				delete users[newUser.id];
			});

		} else {
			socket.emit('joinerror', { message: 'That name is already in use!' });
		}

	}

	return {
		id: id,
		name: name,
		messages: messages,
		objects: objects,
		join: join,
		rejoin: rejoin,
		getImage: getImage
	}
}

module.exports = Board
