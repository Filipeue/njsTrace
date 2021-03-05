
const { performance } = require('perf_hooks');
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const esTransportOpts = {
	level: 'info',
	clientOpts: {
		node: 'http://localhost:9200',
		log: 'info'
	}
};
const esTransport = new ElasticsearchTransport(esTransportOpts);
const winstonLogger = winston.createLogger({
	transports: [
		esTransport
	]
});


const logger = {
	log: function(data) {
		// winstonLogger.info('', data);
		console.log(data);
	}
};

function fnWrapper(descriptor, fn) {
	const start = performance.now();
	try {
		const result = fn();
		if (result && result.then) {
			return result
				.then(function handleThen(r) {
					logger.log(
						Object.assign(
							descriptor,
							{
								exception: false,
								span: performance.now() - start,
							},
						)
					);
					return r;
				})
				.catch(function handleCatch(e) {
					logger.log(
						Object.assign(
							descriptor,
							{
								exception: true,
								span: performance.now() - start,
							},
						)
					);
					throw e;
				});
		}
		logger.log(
			Object.assign(
				descriptor,
				{
					exception: false,
					span: performance.now() - start,
				},
			)
		);
		return result;
	} catch(error) {
		logger.log(
			Object.assign(
				descriptor,
				{
					exception: true,
					span: performance.now() - start,
				},
			)
		);
		throw error;
	}
};

module.exports = fnWrapper;