const path = require('path');
const webpack = require('webpack');

module.exports = {
	entry: './src/index.jsx',
	output: {
		filename: 'bundle.js',
		path: path.resolve(__dirname, 'public'),
		publicPath: '/meal-idea-app/',
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
	mode: 'production',
	plugins: [
		new webpack.DefinePlugin({
			'process.env.FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY),
			'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.FIREBASE_AUTH_DOMAIN),
			'process.env.FIREBASE_PROJECT_ID': JSON.stringify(process.env.FIREBASE_PROJECT_ID),
			'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.FIREBASE_STORAGE_BUCKET),
			'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.FIREBASE_MESSAGING_SENDER_ID),
			'process.env.FIREBASE_APP_ID': JSON.stringify(process.env.FIREBASE_APP_ID),
		}),
	],
};
