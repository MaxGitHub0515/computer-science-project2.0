// webpack.config.cjs
const webpack = require("webpack");
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

/** @type {import("webpack").Configuration} */
module.exports = {
  mode: process.env.NODE_ENV === "production" ? "production" : "development",

  entry: "./src/main.tsx",

  output: {
    path: path.resolve(__dirname, "build"),
    filename: "static/js/[name].[contenthash].js",
    publicPath: "/",
    clean: true,
  },

  devtool: "source-map",

  resolve: {
    extensions: [".tsx", ".ts", ".jsx", ".js"],
  },

  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: "ts-loader",
      },
      {
        test: /\.css$/i,
        use: [
          "style-loader",
          "css-loader",
          "postcss-loader", // Tailwind via postcss.config.js
        ],
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/i,
        type: "asset/resource",
      },
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      template: "index.html", // your client/index.html
    }),
    new webpack.DefinePlugin({
      "process.env.SERVER_URL": JSON.stringify(process.env.SERVER_URL || ""),
    }),
  ],

  devServer: {
    port: 3000,
    historyApiFallback: true, // so react-router-dom works with refresh
    hot: true,
  },
};
