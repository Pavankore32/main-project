pragma solidity ^0.8.0;

contract BlockchainVoting {
    struct Voter {
        bool registered;
        bool voted;
    }
    
    struct Candidate {
        string name;
        uint256 voteCount;
    }
    
    address public admin;
    mapping(address => Voter) public voters;
    Candidate[] public candidates;
    bool public electionActive;
    
    event ElectionStarted();
    event ElectionEnded();
    event VoteCasted(address indexed voter, uint256 candidateIndex);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can perform this action");
        _;
    }
    
    modifier onlyDuringElection() {
        require(electionActive, "Election is not active");
        _;
    }
    
    constructor(string[] memory candidateNames) {
        admin = msg.sender;
        for (uint256 i = 0; i < candidateNames.length; i++) {
            candidates.push(Candidate({name: candidateNames[i], voteCount: 0}));
        }
    }
    
    function registerVoter(address voterAddress) public onlyAdmin {
        require(!voters[voterAddress].registered, "Voter already registered");
        voters[voterAddress] = Voter({registered: true, voted: false});
    }
    
    function startElection() public onlyAdmin {
        electionActive = true;
        emit ElectionStarted();
    }
    
    function endElection() public onlyAdmin {
        electionActive = false;
        emit ElectionEnded();
    }
    
    function vote(uint256 candidateIndex) public onlyDuringElection {
        require(voters[msg.sender].registered, "You are not registered to vote");
        require(!voters[msg.sender].voted, "You have already voted");
        require(candidateIndex < candidates.length, "Invalid candidate");
        
        voters[msg.sender].voted = true;
        candidates[candidateIndex].voteCount++;
        
        emit VoteCasted(msg.sender, candidateIndex);
    }
    
    function getCandidate(uint256 index) public view returns (string memory, uint256) {
        require(index < candidates.length, "Invalid candidate index");
        return (candidates[index].name, candidates[index].voteCount);
    }
}
