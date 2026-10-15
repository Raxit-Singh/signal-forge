// Response shapes from API Direct's endpoint docs (read 2026-10-15). Only the
// fields SignalForge uses are declared; unknown fields pass through. Numbers
// the docs mark as nullable are nullable here.

import { z } from "zod";

const str = z.string();
const optStr = z.string().nullish();
const optNum = z.number().nullish();
const optBool = z.boolean().nullish();

export const redditPostSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, subreddit: optStr, snippet: optStr,
  upvotes: optNum, upvote_ratio: optNum, comments: optNum, crossposts: optNum,
});
export const redditPostsResponse = z.looseObject({ posts: z.array(redditPostSchema), page: optNum, count: optNum });

export const redditCommentSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, subreddit: optStr, snippet: optStr, type: optStr,
  upvotes: optNum, post_upvotes: optNum, post_comments: optNum,
});
export const redditCommentsResponse = z.looseObject({ posts: z.array(redditCommentSchema), pages: optNum, count: optNum });

export const tweetSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, snippet: optStr,
  likes: optNum, retweets: optNum, replies: optNum, quotes: optNum, bookmarks: optNum, views: optNum,
  author_followers: optNum, author_verified: optBool, lang: optStr, is_reply: optBool, is_quote: optBool,
  user_mentions: z.array(z.string()).nullish(),
});
export const xPostsResponse = z.looseObject({ posts: z.array(tweetSchema), pages: optNum, count: optNum, cursor: optStr });
export const xCommentsResponse = z.looseObject({ comments: z.array(tweetSchema), tweet_id: optStr, pages: optNum, count: optNum });
export const xQuotesResponse = z.looseObject({ quotes: z.array(tweetSchema), tweet_id: optStr, pages: optNum, count: optNum });

export const linkedinPostSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, snippet: optStr, urn: optStr,
  likes: optNum, comments: optNum, shares: optNum,
  article: z.looseObject({ url: optStr, title: optStr }).nullish(),
});
export const linkedinPostsResponse = z.looseObject({ posts: z.array(linkedinPostSchema), page: optNum, count: optNum });

export const tiktokVideoSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, snippet: optStr,
  play_count: optNum, likes: optNum, comments: optNum, shares: optNum, is_ad: optBool, author_name: optStr,
});
export const tiktokVideosResponse = z.looseObject({ videos: z.array(tiktokVideoSchema), pages: optNum, count: optNum });

export const tiktokCommentSchema = z.looseObject({
  comment_id: str, video_id: optStr, text: optStr, likes: optNum, date: optStr, date_timestamp: optNum,
  author: optStr, author_name: optStr, author_id: optStr, reply_count: optNum,
});
export const tiktokCommentsResponse = z.looseObject({ comments: z.array(tiktokCommentSchema), video_id: optStr, total: optNum, pages: optNum, count: optNum });

export const instagramPostSchema = z.looseObject({
  title: optStr, url: str, date: optStr, author: optStr, snippet: optStr,
  likes: optNum, comments: optNum, shares: optNum, views: optNum, media_id: optStr, is_paid_partnership: optBool,
});
export const instagramPostsResponse = z.looseObject({ posts: z.array(instagramPostSchema), pages: optNum, count: optNum });

export const instagramCommentSchema = z.looseObject({
  comment_id: str, text: optStr, author: optStr, author_id: optStr, likes: optNum, reply_count: optNum,
  date: optStr, date_timestamp: optNum, url: optStr,
});
export const instagramCommentsResponse = z.looseObject({ comments: z.array(instagramCommentSchema), code: optStr, total: optNum, pages: optNum, count: optNum });

export const facebookPostSchema = z.looseObject({
  post_id: str, url: str, message: optStr, date: optStr, timestamp: optNum,
  author_name: optStr, author_id: optStr, comments_count: optNum, reactions_count: optNum, reshare_count: optNum, external_url: optStr,
});
export const facebookPostsResponse = z.looseObject({ posts: z.array(facebookPostSchema), count: optNum, pages: optNum });

export const facebookCommentSchema = z.looseObject({
  comment_id: str, message: optStr, date: optStr, timestamp: optNum, author_name: optStr, author_id: optStr,
  replies_count: optNum, reactions_count: optNum,
});
export const facebookCommentsResponse = z.looseObject({ comments: z.array(facebookCommentSchema), count: optNum, pages: optNum });

export const substackPostSchema = z.looseObject({
  title: optStr, subtitle: optStr, url: str, date: optStr, author: optStr, author_name: optStr, snippet: optStr,
  likes: optNum, comments: optNum, restacks: optNum, publication: optStr, post_id: z.union([z.string(), z.number()]).nullish(),
  lang: optStr, is_paid: optBool,
});
export const substackPostsResponse = z.looseObject({ posts: z.array(substackPostSchema), page: optNum, has_next_page: optBool, count: optNum });

export const substackNoteSchema = z.looseObject({
  note_id: z.union([z.string(), z.number()]), body: optStr, date: optStr, author: optStr, author_name: optStr, author_id: z.union([z.string(), z.number()]).nullish(),
  likes: optNum, replies: optNum, restacks: optNum, lang: optStr, publication: optStr, url: str,
});
export const substackNotesResponse = z.looseObject({ notes: z.array(substackNoteSchema), pages: optNum, count: optNum });

export const webResultSchema = z.looseObject({
  position: optNum, rank: optNum, title: optStr, url: str, snippet: optStr, source: optStr, domain: optStr,
});
export const webSearchResponse = z.looseObject({ results: z.array(webResultSchema), pages: optNum, count: optNum });

export const newsArticleSchema = z.looseObject({
  title: optStr, url: str, snippet: optStr, published_datetime_utc: optStr,
  authors: z.array(z.string()).nullish(), source_name: optStr, domain: optStr,
});
export const newsArticlesResponse = z.looseObject({ articles: z.array(newsArticleSchema), limit: optNum, count: optNum });

export const trustpilotReviewSchema = z.looseObject({
  review_id: str, review_link: optStr, rating: optNum, title: optStr, review_text: optStr, review_language: optStr,
  review_datetime_utc: optStr, review_timestamp: optNum, is_verified: optBool, like_count: optNum,
  author_id: optStr, author_name: optStr,
});
export const trustpilotReviewsResponse = z.looseObject({
  company: z.looseObject({ name: optStr, domain: optStr, url: optStr, business_unit_id: optStr }).nullish(),
  reviews: z.array(trustpilotReviewSchema),
  count: optNum,
  pages: optNum,
});

export type RedditPost = z.output<typeof redditPostSchema>;
export type RedditComment = z.output<typeof redditCommentSchema>;
export type Tweet = z.output<typeof tweetSchema>;
export type LinkedinPost = z.output<typeof linkedinPostSchema>;
export type TiktokVideo = z.output<typeof tiktokVideoSchema>;
export type TiktokComment = z.output<typeof tiktokCommentSchema>;
export type InstagramPost = z.output<typeof instagramPostSchema>;
export type InstagramComment = z.output<typeof instagramCommentSchema>;
export type FacebookPost = z.output<typeof facebookPostSchema>;
export type FacebookComment = z.output<typeof facebookCommentSchema>;
export type SubstackPost = z.output<typeof substackPostSchema>;
export type SubstackNote = z.output<typeof substackNoteSchema>;
export type WebResult = z.output<typeof webResultSchema>;
export type NewsArticle = z.output<typeof newsArticleSchema>;
export type TrustpilotReview = z.output<typeof trustpilotReviewSchema>;
