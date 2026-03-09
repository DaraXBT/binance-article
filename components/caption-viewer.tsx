'use client';

import { CaptionPackage } from '@prisma/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface CaptionViewerProps {
  captions: CaptionPackage | null;
}

export function CaptionViewer({ captions }: CaptionViewerProps) {
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  if (!captions) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>No captions available</p>
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
    tags: captions.blogTags ? JSON.parse(captions.blogTags) : [],
    sections: captions.blogSections ? JSON.parse(captions.blogSections) : []
  };
  const twitter = {
    singles: [captions.xSingle1, captions.xSingle2, captions.xSingle3].filter(Boolean) as string[],
    thread: captions.xThread || '',
  };

  return (
    <Tabs defaultValue="blog" className="h-full flex flex-col">
      <TabsList className="w-full rounded-none border-b border-border bg-transparent">
        <TabsTrigger value="blog">Blog</TabsTrigger>
        <TabsTrigger value="twitter">Twitter/X</TabsTrigger>
      </TabsList>

      <TabsContent value="blog" className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">SEO Title</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(blog.seoTitle, 'seo-title')}
              >
                {copiedIndex === 'seo-title' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-sm bg-muted p-3 rounded-lg">{blog.seoTitle}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {blog.seoTitle.length}/60 characters
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Meta Description</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(blog.metaDescription, 'meta')}
              >
                {copiedIndex === 'meta' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-sm bg-muted p-3 rounded-lg">{blog.metaDescription}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {blog.metaDescription.length}/160 characters
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Intro Text</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy(blog.introText, 'intro')}
              >
                {copiedIndex === 'intro' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-sm bg-muted p-3 rounded-lg whitespace-pre-wrap">
              {blog.introText}
            </p>
          </div>

          {blog.tags && blog.tags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">Tags</h4>
                <Button
                  size="sm"
                  variant="ghost"
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
                  <span key={tag} className="inline-block bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-xs">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="twitter" className="flex-1 overflow-y-auto p-4">
        <div className="space-y-6">
          {twitter.singles && twitter.singles.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-3">Individual Tweets</h4>
              <div className="space-y-2">
                {twitter.singles.map((tweet: string, idx: number) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Tweet {idx + 1}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(tweet, `tweet-${idx}`)}
                      >
                        {copiedIndex === `tweet-${idx}` ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-sm bg-muted p-3 rounded-lg">{tweet}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {twitter.thread && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-sm">Twitter Thread</h4>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopy(twitter.thread, 'thread')}
                >
                  {copiedIndex === 'thread' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-sm bg-muted p-3 rounded-lg whitespace-pre-wrap">
                {twitter.thread}
              </p>
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
