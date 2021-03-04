
const { performance } = require('perf_hooks');

const logger = {
	log: function(data) {
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
							{
								exception: false,
								span: performance.now() - start,
							},
							descriptor,
						)
					);
					return r;
				})
				.catch(function handleCatch(e) {
					logger.log(
						Object.assign(
							{
								exception: true,
								span: performance.now() - start,
							},
							descriptor,
						)
					);
					throw e;
				});
		}
		logger.log(
			Object.assign(
				{
					exception: false,
					span: performance.now() - start,
				},
				descriptor,
			)
		);
		return result;
	} catch(error) {
		logger.log(
			Object.assign(
				{
					exception: true,
					span: performance.now() - start,
				},
				descriptor,
			)
		);
		throw error;
	}
};

module.exports = fnWrapper;