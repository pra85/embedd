export function decode(html) {
	if(!html) return false;
	
	let txt = document.createElement("textarea");
	txt.innerHTML = html;
	
	return txt.value;
};

export function parseDate(unix) {

	let now = new Date().getTime() / 1000;

	if(!unix || unix > now) return false;

	let seconds = now - unix,
			minutes = Math.floor(seconds / 60),
			hours = Math.floor(minutes / 60),
			days = Math.floor(hours / 24);

	if(days === 1)
		return '1 day ago';
	if(days > 0)
		return days + ' days ago';
	if(hours === 1)
		return '1 hour ago';
	if(hours > 0)
		return hours + ' hours ago';
	if(minutes === 1)
		return '1 minute ago';
	if(minutes > 0)
		return minutes + ' minutes ago';

	return 'a few seconds ago';
};

export function embeddConstructor(spec) {
	if(!spec) { throw new Error('No spec object has been specified'); }
	if(!spec.dataFmt) { throw new Error('dataFmt method isnt defined'); }
	if(!spec.commentFmt) { throw new Error('commentFmt method isnt defined'); }
	if(!spec.threadFmt) { throw new Error('threadFmt method isnt defined'); }
	if(spec.limit === 0) { spec.limit = null; }
	
	let embedd = {};
	
	function get(url) {
		if(!url) throw new Error('No URL has been specified');
		
		return new Promise((resolve, reject) => {
			let req = new XMLHttpRequest();
			req.open('GET', url);
			req.responseType = 'json';

			req.addEventListener('load', () => {
				resolve(req);
			});

			req.addEventListener('error', reject);

			req.send();
		});
	};

	function threadUrl({ sub, id }) {
		if(sub && id) {
			return spec.base + '/r/' + sub + '/comments/' + id + '.json';
		}

		if(!sub && id) {
			return spec.base + id;
		}

		return false;
	};

	function getThreads(data) {
		let activeThreads = data.hits.filter(x => {
			return !!x.num_comments;
		});

		var threads = activeThreads.slice(0,10).map(x => {
			return new Promise((resolve, reject) => {
				let {id, subreddit} = x,
						url = threadUrl({ sub: subreddit, id: id });

				if(id === 'undefined') reject(new Error('No ID specified'));
				
				resolve(get(url));
			});
		});

		return Promise.all(threads);
	};

	function commentConstructor({ comment, op, depth }) {
		let cdepth = depth || 0,
				c = spec.commentFmt(comment);
		
		c.depth = cdepth;
		c.subreddit = op.subreddit;

		if(op.permalink) {
			c.permalink = spec.base + op.permalink;
			c.thread = spec.base + op.permalink + comment.id;
		}

		if(comment.children && comment.children.length > 0) {
			let nxtDepth = cdepth + 1;

			c.hasReplies = true;
			c.replies = comment.children.reduce((arr, r) => {
				if(r.author) {
					arr.push(commentConstructor({comment: r, op: op, depth: nxtDepth }));
				}

				return arr;
			}, []);

			c.loadMore = c.replies.length > 4;
		}

		return c;
	};

	function parseComments(threads) {
		return new Promise((resolve, reject) => {
			var cs = threads.map(x => {
				var op = spec.threadFmt(x.response);
				var comments = op.children.reduce((arr, c) => {
					if(c.author) {
						arr.push(commentConstructor({ comment: c, op: op }));
					}

					return arr;
				},[]);
				return { op: op, comments: comments };
			});
			resolve(cs);
		});
	};

	function mergeComments(comments) {
		return new Promise((resolve, reject) => {
			let merge = (score, arr, index) => {
				if(index > comments.length - 1) {
					return {
						score: score,
						threads: comments.length,
						comments: arr,
						multiple: function() { return this.threads > 1; }
					};
				}
				let data = comments[index],
						newScore = score += data.op.points,
						newComments = arr.concat(data.comments);
				
				return merge(newScore, newComments, index + 1);
			};

			let merged = merge(0, [], 0);
			let sorted = merged.comments.sort((a, b) => {
				return b.score - a.score;
			});

			let limit = spec.limit || sorted.length;

			merged.comments = sorted.slice(0, limit);
			merged.next = sorted.slice(limit);
			merged.hasMore = !!merged.next.length;
			
			resolve(merged);
		});
	};

	function handleError(err) {
		throw new Error(err);
	};

	embedd.data = get(spec.query).then(spec.dataFmt);

	embedd.hasComments = () => {
		return new Promise((resolve, reject) => {
			embedd.data.then(data => {
				let threads = data.hits.filter(x => {
					return !!x.num_comments;
				});
				resolve(!!threads.length);
			});
		});
	};

	embedd.getComments = () => {
		return new Promise((resolve, reject) => {
			embedd.data
				.then(getThreads, handleError)
				.then(parseComments, handleError)
				.then(mergeComments, handleError)
				.then(resolve, handleError)
				.catch(reject);
		});
	};

	return embedd;
};
