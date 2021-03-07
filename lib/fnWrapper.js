
const { performance } = require('perf_hooks');
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const esTransport = new ElasticsearchTransport({
	level: 'info',
	index: 'njsprof',
	clientOpts: {
		node: 'http://localhost:9200',
	},
});
const winstonLogger = winston.createLogger({
	defaultMeta: {
		app: 'sample-cms',
		pid: process.pid,
	},
	transports: [
		// esTransport,
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.splat(),
				winston.format.timestamp(),
				winston.format.simple(),
			),
		})
	]
});


const logger = {
	log: function(data) {
		winstonLogger.info('__njsprof__fnWrapper', data);
		// console.log(data);
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