const path = require('path');

module.exports = {
	entry: './src/index.jsx',
	output: {
		filename: 'bundle.js',
		path: path.resolve(__dirname, 'public'),
	},
	module: {
		rules: [
			{
				test: /\.(js|jsx)$/,
				exclude: /node_modules/,
				use: 'babel-loader',
			},
		],
	},
	resolve: {
		extensions: ['.js', '.jsx'],
	},
	mode: 'development',
};
