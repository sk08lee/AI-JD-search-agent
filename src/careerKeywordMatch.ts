const ENGINEER_ROLE_PATTERN = /(?:研发|开发|测试|算法|后端|前端|客户端|服务端|运维|安全|数据|机器学习|应用)工程师/i;

export function keywordTokens(keyword: string): string[] {
    const normalized = keyword.trim();
    const split = normalized.split(/[\s·\-_/|+]+/).map((part) => part.trim()).filter(Boolean);
    if (split.length > 1) {
        return split;
    }

    const prefixed = normalized.match(/^([a-zA-Z][a-zA-Z0-9]*)([\u4e00-\u9fa5].+)$/);
    if (prefixed) {
        return [prefixed[1], prefixed[2]];
    }

    const chineseParts = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9]+/g) || [];
    return chineseParts.length > 0 ? chineseParts : [normalized];
}

export function hasConflictingRole(text: string, keyword: string): boolean {
    const title = text.slice(0, 120);
    const keywordLower = keyword.toLowerCase();
    const titleLower = title.toLowerCase();

    const keywordIsProduct = /产品经理|产品/.test(keywordLower);
    const titleIsEngineer = ENGINEER_ROLE_PATTERN.test(titleLower);
    const titleIsProduct = /产品/.test(titleLower);

    if (keywordIsProduct && titleIsEngineer && !titleIsProduct) {
        return true;
    }

    return false;
}

export function getListSearchKeyword(keyword: string, listSearchKeyword?: string): string {
    if (listSearchKeyword?.trim()) {
        return listSearchKeyword.trim();
    }

    const chineseParts = keyword.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    if (chineseParts.length > 0) {
        return chineseParts.sort((a, b) => b.length - a.length)[0]!;
    }

    return keyword.trim();
}

export function matchesJobKeywordAtListStage(
    text: string,
    keyword: string,
    options?: { listSearchKeyword?: string; matchKeywordOnDetailOnly?: boolean }
): boolean {
    if (options?.matchKeywordOnDetailOnly && options.listSearchKeyword?.trim()) {
        const listKeyword = getListSearchKeyword(keyword, options.listSearchKeyword);
        return matchesJobKeyword(text, listKeyword);
    }

    return matchesJobKeyword(text, keyword);
}

export function matchesPortalJobKeyword(
    text: string,
    keyword: string,
    portalSearch?: { listSearchKeyword?: string; matchKeywordOnDetailOnly?: boolean }
): boolean {
    if (matchesJobKeyword(text, keyword)) {
        return true;
    }

    if (portalSearch?.matchKeywordOnDetailOnly && portalSearch.listSearchKeyword?.trim()) {
        return matchesJobKeyword(text, portalSearch.listSearchKeyword.trim());
    }

    return false;
}

export function matchesJobKeyword(text: string, keyword: string): boolean {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const compactText = normalized.replace(/\s+/g, '').toLowerCase();
    const compactKeyword = keyword.replace(/\s+/g, '').toLowerCase();

    if (!compactKeyword) return false;
    if (compactText.includes(compactKeyword)) return true;

    if (hasConflictingRole(normalized, keyword)) {
        return false;
    }

    const tokens = keywordTokens(keyword);
    const chineseTokens = tokens.filter((token) => /[\u4e00-\u9fa5]{2,}/.test(token));
    const otherTokens = tokens.filter((token) => !/[\u4e00-\u9fa5]{2,}/.test(token));

    if (chineseTokens.length > 0) {
        const allChineseMatched = chineseTokens.every((token) =>
            compactText.includes(token.toLowerCase())
        );
        if (!allChineseMatched) {
            return false;
        }
    }

    if (otherTokens.length > 0) {
        if (chineseTokens.length > 0) {
            const anyOtherMatched = otherTokens.some((token) =>
                compactText.includes(token.toLowerCase())
            );
            if (!anyOtherMatched) {
                return false;
            }
        } else if (!otherTokens.every((token) => compactText.includes(token.toLowerCase()))) {
            return false;
        }
    }

    return tokens.length > 0;
}

export function scoreJobKeywordMatch(text: string, keyword: string): number {
    const compactText = text.replace(/\s+/g, '').toLowerCase();
    const compactKeyword = keyword.replace(/\s+/g, '').toLowerCase();
    let score = 0;

    if (compactText.includes(compactKeyword)) {
        score += 10;
    }

    for (const token of keywordTokens(keyword)) {
        if (compactText.includes(token.toLowerCase())) {
            score += /[\u4e00-\u9fa5]{2,}/.test(token) ? 3 : 1;
        }
    }

    if (hasConflictingRole(text, keyword)) {
        score -= 20;
    }

    return score;
}
