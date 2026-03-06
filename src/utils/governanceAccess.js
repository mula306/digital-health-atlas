const getRoles = (currentUser) => {
    return Array.isArray(currentUser?.roles) ? currentUser.roles : [];
};

export const canRouteGovernanceSubmission = ({ hasPermission, currentUser }) => {
    const roles = getRoles(currentUser);
    return (
        hasPermission('can_manage_governance') ||
        hasPermission('can_manage_intake') ||
        roles.includes('Admin') ||
        roles.includes('IntakeManager')
    );
};

export const getGovernanceReviewPermissions = ({ review, currentUser, hasPermission }) => {
    const participants = Array.isArray(review?.participants) ? review.participants : [];
    const myParticipant = participants.find((participant) => participant.userOid === currentUser?.oid) || null;
    const isEligibleVoter = !!myParticipant?.isEligibleVoter;
    const isChair = isEligibleVoter && myParticipant?.participantRole === 'chair';
    const canVoteGovernance = hasPermission('can_vote_governance');
    const canDecideGovernance = hasPermission('can_decide_governance');
    const isInReview = review?.status === 'in-review';
    const deadlinePassed = !!review?.deadlinePassed;
    const decisionRequiresQuorum = !!review?.policy?.decisionRequiresQuorum;
    const quorumMet = review?.scoreSummary?.quorumMet !== false;

    let voteBlocker = '';
    if (!canVoteGovernance) voteBlocker = 'You do not have permission to vote.';
    else if (!isInReview) voteBlocker = 'Voting is only available while review is in progress.';
    else if (!isEligibleVoter) voteBlocker = 'You are not an eligible voter for this review.';
    else if (deadlinePassed) voteBlocker = 'Voting window is closed.';

    let decisionBlocker = '';
    if (!canDecideGovernance) decisionBlocker = 'You do not have permission to record a decision.';
    else if (!isInReview) decisionBlocker = 'Decisions can only be recorded while review is in progress.';
    else if (!isChair) decisionBlocker = 'Only the governance chair can record the final decision.';
    else if (decisionRequiresQuorum && !quorumMet) decisionBlocker = 'Quorum is required before recording a decision.';

    return {
        isChair,
        isEligibleVoter,
        canVote: voteBlocker === '',
        voteBlocker,
        canDecide: decisionBlocker === '',
        decisionBlocker
    };
};
