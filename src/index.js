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
import write from './write.html';

const app = new Hono();

//1. The UI for the asking questions (this loads the ui for the questions)
app.get('/', (c) => c.html(ui));


//2. A GET end point to query the LLM
// v1 (Query the LLm and return it)
// v2 (Query the )
// v2-1 Generate a embedding for the query
// v2-2 look up similar vectors to our query embedding
// v2-3 if there are similar vectors look into the d1 database and return the notes
// v2-4 embed the note content inside our query
// v2-5 query the LLM with the query and the note content and return the answer --- This is RAG
// app.get('/query', async (c) => {
// 	//v1
// 	// const ai = new Ai(c.env.AI);
// 	// const question = c.req.query("text") || "How are you?";

// 	// const {response : answer} = await ai.run(
// 	// 	"@cf/meta/llama-2-7b-chat-int8",
// 	// 	{
// 	// 		messages: [
// 	// 			{role: "system", content: "You are a helpful assistant"},
// 	// 			{role: "user", content: question},
// 	// 		]
// 	// 	}
// 	// )
// 	// // console.log(answer);
// 	// return c.text(answer);

// 	//v2
// 	const ai = new Ai(c.env.AI);
// 	const question = c.req.query("text") || "How are you?";


// 	//v2-1 (The model I've used here should be same as the one used for the vector database)
// 	const embedding = await ai.run('@cf/baai/bge-base-en-v1.5', { 
// 		text: question //passing the question to the embedding model
// 	});


// 	//v2-2
// 	const vectors = embedding.data[0]; 

// 	//VECTOR_INDEX. querry (this will search in the vector database)
// 	//Anything matching the question, return the ids
// 	const SIMILARITY_CUTOFF = 0.75
// 	const vectorQuery = await c.env.VECTORIZE.query(vectors,{topK: 1});
// 	const vecIds = vectorQuery.matches
// 	.filter(vec => vec.score > SIMILARITY_CUTOFF)
// 	.map(vec => vec.vectorId);
// 	//we got the ids, in next we get the notes from the database

// 	//v2-3
// 	let notes = [];
// 	if(vecIds.length) {
// 		const query = `SELECT * FROM notes WHERE id IN (${vecIds.join(',')})`;
// 		const {results} = await c.env.DATABASE.prepare(query).bind().all();
// 		if(results.length) {
// 			notes = results.map(row => row.text);
// 		}
// 	}

// 	//v2-4

// 	//Context -
// 	//1. This is my note content
// 	//2. This is my another note content
// 	const contextMessage = notes.length
// 	? `Context:\n${notes.map(note => `- ${note}`).join('\n')}`
// 	:""

// 	const systermPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`

// 	const {	response : answer} = await ai.run(
// 		"@cf/meta/llama-2-7b-chat-int8",
// 		{
// 			messages : [
// 				...(notes.length ? [{role : 'system', content : contextMessage}] : []),
// 				{role : 'system', content : systermPrompt},
// 				{role : 'user', content : question}
// 			]
// 		}
// 	)

// 	return c.text(answer);
// });

app.onError((err, c) => {
    console.error("Application error:", err);
    return c.text("Internal Server Error", 500);
});

async function initVectorizeIndex(env) {
    try {
        if (!env.VECTORIZE) {
            throw new Error("VECTORIZE binding is not configured");
        }
        
        // Remove the list() check since it's not available
        console.log("Vectorize binding verified");
        return true;
    } catch (error) {
        console.error("Vectorize index initialization error:", error);
        throw error;
    }
}
// Add this function to initialize the database
async function initDatabase(env) {
    try {
        // Check if table exists
        const { results } = await env.DB.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'"
        ).all();
        
        if (!results || results.length === 0) {
            // Create table if it doesn't exist
            await env.DB.batch([schema]);
            console.log("Notes table created successfully");
        }
        
        return true;
    } catch (error) {
        console.error("Database initialization error:", error);
        throw error;
    }
}

app.get('/query', async (c) => {
    try {
        // Validate environment first
        if (!c.env.AI) throw new Error("AI binding not configured");
        if (!c.env.VECTORIZE) throw new Error("VECTORIZE binding not configured");
        if (!c.env.DB) throw new Error("Database not configured");

        const ai = new Ai(c.env.AI);

        // Parse and validate question
        const url = new URL(c.req.url);
        const question = url.searchParams.get("text")?.trim();
        
        if (!question) {
            return c.text("Please provide a valid question", 400);
        }

        // Generate embedding
        const embeddingResponse = await ai.run("@cf/baai/bge-base-en-v1.5", { 
            text: question
        });

        if (!embeddingResponse?.data?.[0]) {
            throw new Error("Failed to generate embedding");
        }

        const queryVector = embeddingResponse.data[0];

        // Query vector database
        console.log("Querying vectorize index...");
        const vectorQueryResult = await c.env.VECTORIZE.query(queryVector, {
            topK: 5,
            returnVectors: true,
            returnMetadata: true
        });

        if (!vectorQueryResult?.matches) {
            console.log("No matches found in vector database");
            return c.text("I don't have enough context to answer that question.");
        }

        // Process similar vectors with null checks
        const SIMILARITY_CUTOFF = 0.75;
        const similarVectorIds = vectorQueryResult.matches
            .filter(match => match?.score >= SIMILARITY_CUTOFF && match?.vectorId)
            .map(match => match.vectorId)
            .filter(Boolean); // Remove any null/undefined values

        // Query database with validation
        let notes = [];
        if (similarVectorIds.length > 0) {
            try {
                const placeholders = similarVectorIds.map(() => '?').join(',');
                const query = `SELECT text FROM notes WHERE id IN (${placeholders})`;
                const { results } = await c.env.DB
                    .prepare(query)
                    .bind(...similarVectorIds.map(id => id || null))
                    .all();
                
                notes = results
                    ?.filter(row => row?.text)
                    ?.map(row => row.text) || [];
            } catch (dbError) {
                console.error("Database query error:", dbError);
                throw new Error("Failed to retrieve notes from database");
            }
        }

        // Prepare context with validation
        const context = notes.length ? 
            `Context:\n${notes.map(note => `- ${note}`).join('\n')}\n\n` : 
            "";

        // Prepare messages for LLM
        const messages = [
            ...(context ? [{ role: "system", content: context }] : []),
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: question }
        ];

        // Get LLM response
        const { response: answer } = await ai.run("@cf/meta/llama-2-7b-chat-int8", { 
            messages 
        });

        if (!answer) {
            throw new Error("Failed to generate response");
        }

        return c.text(answer);

    } catch (error) {
        console.error("Query processing error:", {
            message: error.message,
            stack: error.stack,
            name: error.name,
            url: c.req.url
        });

        return c.text(
            `Error processing query: ${error.message}`,
            500
        );
    }
});

// Update middleware to check for VECTORIZE instead of VECTORIZE_INDEX
app.use(async (c, next) => {
    if (!c.env.AI || !c.env.VECTORIZE || !c.env.DB) {
        return c.text("Missing required environment configuration", 500);
    }
    await next();
});




//3. A GET end point to write to the LLM
app.get('/write', (c) => c.html(write));
//4. A POST end point to write to the LLM
//a. insert the note into the d1 database,
//b. Generate a embedding based on our note
//c. insert the embeddings into the vector database
app.post('/write', async (c) => {
    try {
        // Initialize database first
        await initDatabase(c.env);
        
        const body = await c.req.json();
        const text = body.text;
        
        if (!text?.trim()) {
            return c.json({ error: "Missing or invalid text input" }, 400);
        }

        const ai = new Ai(c.env.AI);
        const id = crypto.randomUUID();
        
        // Generate embedding
        const embeddingResponse = await ai.run("@cf/baai/bge-base-en-v1.5", { 
            text: text.trim() 
        });

        if (!embeddingResponse?.data?.[0]) {
            throw new Error("Failed to generate embedding");
        }

        // Insert into Vectorize
        await c.env.VECTORIZE.insert([{
            id: id,
            values: embeddingResponse.data[0],
            metadata: { text: text.trim() }
        }]);

        // Insert into D1
        await c.env.DB.prepare(
            "INSERT INTO notes (id, text) VALUES (?, ?)"
        ).bind(id, text.trim()).run();

        return c.json({ 
            success: true, 
            id: id,
            message: "Note saved successfully" 
        });

    } catch (error) {
        console.error("Write error:", error);
        return c.json({ 
            error: "Failed to save note: " + error.message 
        }, 500);
    }
});


export default {
	async fetch(request, env, ctx) {
		return app.fetch(request, env, ctx);
	},
};

