import webpack from 'webpack';
import TerserPlugin from "terser-webpack-plugin";
import * as path from 'path';

export default [
	{
		target: "web",
		entry: "./index.ts",
		output: {
			path: path.resolve(process.cwd(), "dist"),
			filename: "main.browser.js",
			libraryExport: "default",
			libraryTarget: "window",
			library: "Surreal",
			clean: true,
		},
		devtool: "inline-source-map",
		resolve: {
			extensions: [".ts", ".js"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?/,
					use: "ts-loader",
					exclude: /node_modules/,
				},
			],
		},
	},
	{
		target: "node",
		entry: "./index.ts",
		output: {
			path: path.resolve(process.cwd(), "dist"),
			filename: "main.node.js",
			libraryExport: "default",
			libraryTarget: "umd",
			library: "Surreal",
		},
		devtool: "inline-source-map",
		resolve: {
			extensions: [".ts", ".js"],
		},
		module: {
			rules: [
				{
					test: /\.tsx?/,
					use: "ts-loader",
					exclude: /node_modules/,
				},
			],
		},
	},
];
