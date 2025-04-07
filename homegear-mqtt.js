/* Copyright (c) 2015 René Köcher
 * See the file LICENSE for copying permission.
 */
module.exports = function(RED) {
	"use strict";

	var fs = require('fs');
	var path = require('path');
	var clone = require('clone');

	var homegear = require('./lib/homegearCommon');

	/* FIXME: this needs work if there's to be support for multiple families. */
	var devspecs = JSON.parse(fs.readFileSync(path.join(__dirname,'families', 'homematic.json')));

	function HomegearMqttInNode(n) {
		RED.nodes.createNode(this, n);

		this.broker = n.broker;
		this.brokerConn = RED.nodes.getNode(this.broker);
		this.peerId = n.peerId;
		this.homegearId = n.homegearId;
		this.deviceType = devspecs[Number((n.deviceType || '0:0').split(':')[0])];
		this.deviceState = homegear.payloadDictForDevice(this.deviceType);
		this.publishUpdates = n.publishUpdates;
		this.publishComplete = n.publishComplete;

		this.topicPrefix = 'homegear' + (this.homegearId ? '/' + this.homegearId : '');
		this.eventTopic = this.topicPrefix + '/jsonobj/' + this.peerId + '/#';

		var node = this;

		function processMqttPayload(topic, payload) {
			var newState = {};
			if(node.publishComplete === true || node.publishUpdates === true) {
				newState = clone(node.deviceState);
			}
			if(homegear.updatePayload(node.deviceType, newState, topic, payload)) {
				if(RED.util.compareObjects(node.deviceState, newState) === true) {
					if(node.publishUpdates === true) {
						/* we only publish updates and there has been no change */
						return;
					}
				} else {
					node.deviceState = newState;
				}
				if(node.publishComplete === true) {
					if(homegear.payloadIsComplete(node.deviceState) === false) {
						/* state is incomplete and we only publish complete states */
						return;
					}
				}
				/* good to send */
				node.send({topic: node.name, payload: node.deviceState});
			}
		}

		if(this.brokerConn && this.deviceType){
			this.status({fill:'red', shape:'ring', text:"node-red:common.status.disconnected"});

			node.log('subscribing to topic "' + node.eventTopic + '"');
			this.brokerConn.subscribe(node.eventTopic, 2, function(topic, payload, packet) {
				payload = JSON.parse(payload.toString());
				processMqttPayload(topic, payload);
			}, this.id);

			if(this.brokerConn.connected) {
				node.status({fill:'blue', shape:'dot', text:"node-red:common.status.connected"});
			}
			node.brokerConn.register(this);
		}

		this.on('close', function() {
			if(node.brokerConn) {
				node.brokerConn.unsubscribe(node.eventTopic,node.id);
				node.brokerConn.deregister(node);
			}
		});
	}
	RED.nodes.registerType('homegear-mqtt in', HomegearMqttInNode);

	function HomegearMqttOutNode(n) {
		RED.nodes.createNode(this, n);

		this.broker        = n.broker;
		this.brokerConn    = RED.nodes.getNode(this.broker);
		this.peerId        = n.peerId;
		this.homegearId    = n.homegearId;
		this.deviceType    = devspecs[Number((n.deviceType || '0:0').split(':')[0])];
		this.deviceParams  = homegear.writeableParamsForDevice(this.deviceType);
		this.paramName     = n.paramName;
		this.paramValue    = n.paramValue;

		this.topicPrefix = 'homegear' + (this.homegearId ? '/' + this.homegearId : '');
		this.setTopic = this.topicPrefix + '/set/' + this.peerId + '/';

		var node = this;

		if(this.brokerConn && this.deviceType){
			this.status({fill:'red', shape:'ring', text:"node-red:common.status.disconnected"});

			if(this.brokerConn.connected) {
				node.status({fill:'blue', shape:'dot', text:"node-red:common.status.connected"});
			}
			node.brokerConn.register(this);
		}

		this.on('input', function(input) {
			var msg = {
				qos: 2,
				retain: false,
				payload: {
					method: 'setValue',
					params: [ parseInt(node.peerId) ],
					id: node.rpcId
				}
			};

			var paramName = input.name || node.paramName;
			var paramValue = input.value || node.paramValue;

			this.deviceParams.forEach(function(param){
				if(param.name === paramName) {
					msg.topic = node.setTopic + param.channel.toString() + '/' + param.name.split('.').pop();
					if(param.type === 'string') {
						msg.payload = paramValue.toString();
					} else if(param.type === 'action') {
						msg.payload = Boolean(paramValue);
					} else {
						msg.payload = Number(paramValue);
					}
				}
			});

			if("topic" in msg){
				node.brokerConn.publish(msg);
			} else {
				node.error('"' + paramName + '" did not match any supported parameter');
			}
		});

		this.on('close', function() {
			if(node.brokerConn) {
				node.brokerConn.deregister(node);
			}
		});
	}
	RED.nodes.registerType('homegear-mqtt out', HomegearMqttOutNode);


	RED.httpAdmin.get('/homegear-mqtt/families/:familyName', function(req, res){
		var filename = path.join(__dirname , 'families', req.params.familyName + '.json');
		res.sendFile(filename);
	 });

	RED.httpAdmin.get('/homegear-mqtt/common', function(req, res){
		var filename = path.join(__dirname , 'lib', 'homegearCommon.js');
		res.sendFile(filename);
	});
}

/* vim: ts=4 sw=4 sts=4 noet :
 */
