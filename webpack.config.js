import webpack from 'webpack';

export default [
	{
		target: 'web',
		entry: './index.js',
		output: {
			clean: true,
			filename: 'index.js',
			path: new URL('./dist/web', import.meta.url).pathname,
			libraryExport: 'default',
			libraryTarget: 'window',
			library: 'Surreal'
		},
		devtool: false,
		plugins: [
			new webpack.NormalModuleReplacementPlugin(
				/..\/websocket\/index.js$/,
				'/src/websocket/index.web.js',
			)
		],
		module: {
			rules: [{
				test: /\.js$/,
				exclude: /(node_modules)/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: ['@babel/preset-env'],
						plugins: [
							'@babel/plugin-proposal-class-properties',
							'@babel/plugin-proposal-private-methods',
						],
					}
				}
			}]
		}
	},
	{
		target: 'node',
		entry: './index.js',
		output: {
			clean: true,
			filename: 'index.cjs',
			path: new URL('./dist/lib', import.meta.url).pathname,
			libraryExport: 'default',
			libraryTarget: 'umd',
			library: 'Surreal'
		},
		devtool: false,
		plugins: [
			new webpack.NormalModuleReplacementPlugin(
				/..\/websocket\/index.js$/,
				'/src/websocket/index.node.js',
			)
		],
		module: {
			rules: [{
				test: /\.js$/,
				exclude: /(node_modules)/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: ['@babel/preset-env'],
						plugins: [
							'@babel/plugin-proposal-class-properties',
							'@babel/plugin-proposal-private-methods',
						],
					}
				}
			}]
		}
	},
];
