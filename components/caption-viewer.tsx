'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { useLanguage } from '@/components/language-provider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { CaptionPackage } from '@/lib/schemas';

interface CaptionViewerProps {
  captions: CaptionPackage | null;
}

export function CaptionViewer({ captions }: CaptionViewerProps) {
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const { messages } = useLanguage();

  if (!captions) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>{messages.captions.noCaptions}</p>
      </div>
    );
  }

  const handleCopy = (text: string, index: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const blog = {
    seoTitle: captions.blogTitle || '',
    metaDescription: captions.blogMeta || '',
    introText: captions.blogIntro || '',
    tags: captions.blogTags ?? [],
    sections: captions.blogSections ?? [],
  };
  const twitter = {
    singles: [captions.xSingle1, captions.xSingle2, captions.xSingle3].filter(Boolean) as string[],
    thread: captions.xThread || '',
  };

  return (
    <Tabs defaultValue="blog" className="flex h-full flex-col bg-card/20">
      <TabsList className="w-full rounded-none border-b border-dotted border-border bg-transparent">
        <TabsTrigger value="blog">{messages.captions.blog}</TabsTrigger>
        <TabsTrigger value="twitter">{messages.captions.twitter}</TabsTrigger>
      </TabsList>

      <TabsContent value="blog" className="flex-1 break-words overflow-y-auto p-4 [overflow-wrap:anywhere]">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">{messages.captions.seoTitle}</h4>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => handleCopy(blog.seoTitle, 'seo-title')}
              >
                {copiedIndex === 'seo-title' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="rounded-lg border border-dotted border-border bg-muted/40 p-3 text-sm">{blog.seoTitle}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {messages.captions.characters(blog.seoTitle.length, 60)}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">{messages.captions.metaDescription}</h4>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => handleCopy(blog.metaDescription, 'meta')}
              >
                {copiedIndex === 'meta' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="rounded-lg border border-dotted border-border bg-muted/40 p-3 text-sm">{blog.metaDescription}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {messages.captions.characters(blog.metaDescription.length, 160)}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">{messages.captions.introText}</h4>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => handleCopy(blog.introText, 'intro')}
              >
                {copiedIndex === 'intro' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="whitespace-pre-wrap rounded-lg border border-dotted border-border bg-muted/40 p-3 text-sm">
              {blog.introText}
            </p>
          </div>

          {blog.tags && blog.tags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">{messages.captions.tags}</h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                  onClick={() => handleCopy(blog.tags.join(', '), 'tags')}
                >
                  {copiedIndex === 'tags' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {blog.tags.map((tag: string) => (
                  <span key={tag} className="inline-block rounded-md bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="twitter" className="flex-1 break-words overflow-y-auto p-4 [overflow-wrap:anywhere]">
        <div className="space-y-6">
          {twitter.singles && twitter.singles.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-3">{messages.captions.individualTweets}</h4>
              <div className="space-y-2">
                {twitter.singles.map((tweet: string, idx: number) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {messages.captions.tweet(idx + 1)}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg"
                        onClick={() => handleCopy(tweet, `tweet-${idx}`)}
                      >
                        {copiedIndex === `tweet-${idx}` ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="rounded-lg border border-dotted border-border bg-muted/40 p-3 text-sm">{tweet}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {twitter.thread && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">{messages.captions.twitterThread}</h4>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg"
                  onClick={() => handleCopy(twitter.thread, 'thread')}
                >
                  {copiedIndex === 'thread' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="whitespace-pre-wrap rounded-lg border border-dotted border-border bg-muted/40 p-3 text-sm">
                {twitter.thread}
              </p>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
