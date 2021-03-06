var _ = require('lodash');
var expect = require('chai').expect;
var uuid = require('uuid');
var jut_node_kafka = require('../index');
var Promise = require('bluebird');
var Tmp = require('tmp');

var broker = process.env.NODE_KAFKA_NATIVE_BROKER || 'localhost:9092';
var default_timeout = 30000;

// Tests below assume auto topic creation is enabled in the broker.
var gen_topic_name = function() {
    return 'node-kafka-native-test-' + uuid.v4();
}

describe('user level api', function() {
    this.timeout(default_timeout);

    it('should create a Consumer', function() {
        var tmpdir = Tmp.dirSync().name;
        var topic = gen_topic_name();

        var consumer = new jut_node_kafka.Consumer({
            broker: broker,
            topic: topic,
            offset_directory: tmpdir,
            receive_callback: function() {
                return Promise.resolve();
            },
        });
        return consumer.start()
        .delay(100).then(function() {
            consumer.pause();
            return Promise.resolve();
        })
        .delay(100).then(function() {
            consumer.resume();
            return Promise.resolve();
        })
        .then(function() {
            return consumer.stop();
        });
    });

    it('should create a Producer', function() {
        var topic = gen_topic_name();

        var producer = new jut_node_kafka.Producer({
            broker: broker,
        });
        return producer.partition_count(topic)
        .then(function(npartitions) {
            // If the below fails, ensure your kafka broker is configured to
            // with a 'num.partitions' count greater than 1.
            expect(npartitions).gt(1);
            for (var i = 0; i < npartitions; ++i) {
                producer.send(topic, i, ['p' + i]);
            }
            return Promise.delay(100);
        })
        .then(function() {
            return producer.stop();
        });
    });

    it('should record offsets processed in offset directory', function() {
        var topic = gen_topic_name();
        var tmpdir = Tmp.dirSync().name;
        var producer = new jut_node_kafka.Producer({
            broker: broker,
        });

        var npartitions;
        function send() {
            for (var i = 0; i < npartitions; ++i) {
                producer.send(topic, i, ['p' + i]);
            }
        }
        // Create a new consumer and wait to receive a messages
        // that should _only_ have the given offset.
        function create_and_verify_consumer(expected_offset) {
            var resolve, reject;
            var promise = new Promise(function() {
                resolve = arguments[0];
                reject = arguments[1];
            });
            var received = {};

            var consumer = new jut_node_kafka.Consumer({
                broker: broker,
                topic: topic,
                offset_directory: tmpdir,
                receive_callback: function(data) {
                    return Promise.try(function() {
                        expect(data.repeats).equals(0);
                        expect(data.misses).equals(0);
                        _.each(data.messages, function(msg) {
                            expect(msg.topic).equals(topic);
                            expect(msg.payload).equals('p' + msg.partition);
                            if (msg.offset !== expected_offset) {
                                reject(new Error('saw unexpected offset ' + msg.offset));
                            } else {
                                received[msg.partition] = true;
                            }
                        });
                        if (_.keys(received).length === npartitions) {
                            resolve();
                        }
                    });
                },
            });

            return consumer.start()
            .then(function() {
                return promise;
            })
            .finally(function() {
                return consumer.stop();
            });
        }

        return producer.partition_count(topic)
        .then(function(n) {
            npartitions = n;
            send();
            return create_and_verify_consumer(0);
        })
        .then(function() {
            send();
            return create_and_verify_consumer(1);
        });
    });

});
