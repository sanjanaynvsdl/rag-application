/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import {Ai} from '@cloudflare/ai';
import {Hono} from 'hono';
import ui from './ui.html';

const app = new Hono();

//1. The UI for the asking questions (this loads the ui for the questions)
app.get('/', (c) => c.html(ui));

export default {
	async fetch(request, env, ctx) {
		return app.fetch(request, env, ctx);
	},
};
