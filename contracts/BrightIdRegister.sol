pragma solidity ^0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "./RegisterAndCall.sol";

contract BrightIdRegister is AragonApp {
    using SafeMath for uint256;

    bytes32 constant public UPDATE_SETTINGS_ROLE = keccak256("UPDATE_SETTINGS_ROLE");

    string private constant ERROR_NO_VERIFIERS = "BRIGHTID_NO_VERIFIERS";
    string private constant ERROR_REGISTRATION_PERIOD_ZERO = "BRIGHTID_REGISTRATION_PERIOD_ZERO";
    string private constant ERROR_SENDER_NOT_IN_VERIFICATION = "BRIGHTID_SENDER_NOT_IN_VERIFICATION";
    string private constant ERROR_ADDRESS_VOIDED = "BRIGHTID_ADDRESS_VOIDED";
    string private constant ERROR_INCORRECT_TIMESTAMPS = "BRIGHTID_INCORRECT_TIMESTAMPS";
    string private constant ERROR_NO_UNIQUE_ID_ASSIGNED = "BRIGHTID_NO_UNIQUE_ID_ASSIGNED";
    string private constant ERROR_INCORRECT_SIGNATURES = "BRIGHTID_INCORRECT_SIGNATURES";
    string private constant ERROR_INCORRECT_VERIFIER = "BRIGHTID_INCORRECT_VERIFIER";
    string private constant ERROR_BAD_TIMESTAMP = "BRIGHTID_BAD_TIMESTAMP";

    struct UserRegistration {
        address uniqueUserId;
        uint256 registerTime;
        bool addressVoid;
    }

    bytes32 public brightIdContext;
    address[] public brightIdVerifiers;
    uint256 public registrationPeriod;
    uint256 public verificationTimestampVariance;

    mapping (address => UserRegistration) public userRegistrations;

    event Register(address sender);

    /**
    * @param _brightIdContext BrightId context used for verifying users
    * @param _brightIdVerifiers Addresses used to verify signed BrightId verifications
    * @param _registrationPeriod Length of time after a registration before registration is required again
    * @param _verificationTimestampVariance Acceptable period of time between creating a BrightId verification
    *       and registering it with the BrightIdRegister
    */
    function initialize(
        bytes32 _brightIdContext,
        address[] _brightIdVerifiers,
        uint256 _registrationPeriod,
        uint256 _verificationTimestampVariance
    )
        public onlyInit
    {
        require(_brightIdVerifiers.length > 0, ERROR_NO_VERIFIERS);
        require(_registrationPeriod > 0, ERROR_REGISTRATION_PERIOD_ZERO);

        brightIdContext = _brightIdContext;
        brightIdVerifiers = _brightIdVerifiers;
        registrationPeriod = _registrationPeriod;
        verificationTimestampVariance = _verificationTimestampVariance;

        initialized();
    }

    /**
    * @notice Set the BrightId verifier address to `_brightIdVerifier`
    * @param _brightIdVerifiers Addresses used to verify signed BrightId verifications
    */
    function setBrightIdVerifiers(address[] _brightIdVerifiers) external auth(UPDATE_SETTINGS_ROLE) {
        require(_brightIdVerifiers.length > 0, ERROR_NO_VERIFIERS);
        brightIdVerifiers = _brightIdVerifiers;
    }

    /**
    * @notice Set the registration period to `_registrationPeriod`
    * @param _registrationPeriod Length of time after a registration before registration is required again
    */
    function setRegistrationPeriod(uint256 _registrationPeriod) external auth(UPDATE_SETTINGS_ROLE) {
        require(_registrationPeriod > 0, ERROR_REGISTRATION_PERIOD_ZERO);
        registrationPeriod = _registrationPeriod;
    }

    /**
    * @notice Set the verification timestamp variance to `_verificationTimestampVariance`
    * @param _verificationTimestampVariance Acceptable period of time between fetching a BrightId verification
    *       and registering it with the BrightIdRegister
    */
    function setVerificationTimestampVariance(uint256 _verificationTimestampVariance) external auth(UPDATE_SETTINGS_ROLE) {
        verificationTimestampVariance = _verificationTimestampVariance;
    }

    function getBrightIdVerifiers() external view returns (address[]) {
        return brightIdVerifiers;
    }

    /**
    * @notice Register the sender as a unique individual with a BrightId verification and assign the first address
    *       they registered with as their unique ID
    * @param _addrs The history of addresses, or contextIds, used by this user to register with BrightID for the _brightIdContext
    * @param _timestamps The time the verification was created for each verifier by a BrightId node
    * @param _v Part of the BrightId nodes signature for each verifier verifying the users uniqueness
    * @param _r Part of the BrightId nodes signature for each verifier verifying the users uniqueness
    * @param _s Part of the BrightId nodes signature for each verifier verifying the users uniqueness
    * @param _registerAndCall Contract to call after registration, set to 0x0 to register without forwarding data
    * @param _functionCallData Function data to call on the contract address after registration
    */
    function register(
        address[] _addrs,
        uint256[] _timestamps,
        uint8[] _v,
        bytes32[] _r,
        bytes32[] _s,
        RegisterAndCall _registerAndCall,
        bytes _functionCallData
    )
        public // public instead of external to mitigate stack too deep error
    {
        UserRegistration storage userRegistration = userRegistrations[msg.sender];
        require(msg.sender == _addrs[0], ERROR_SENDER_NOT_IN_VERIFICATION);
        _requireIsVerified(_addrs, _timestamps, _v, _r, _s);
        require(!userRegistration.addressVoid, ERROR_ADDRESS_VOIDED);

        userRegistration.registerTime = getTimestamp();

        address uniqueUserId = _addrs[_addrs.length - 1];  // The last address is/was the first address registered with the _brightIdContext
        if (userRegistration.uniqueUserId == address(0)) {
            userRegistration.uniqueUserId = uniqueUserId;
            _voidPreviousRegistrations(_addrs);
        }

        // We do this to ensure calls of uniqueUserId() that use the result of uniqueUserId() will
        // return the uniqueUserId even if the user has not registered their initial address
        if (userRegistrations[uniqueUserId].uniqueUserId == address(0)) {
            userRegistrations[uniqueUserId].uniqueUserId = uniqueUserId;
        }

        if (address(_registerAndCall) != address(0)) {
            _registerAndCall.receiveRegistration(msg.sender, userRegistration.uniqueUserId, _functionCallData);
        }

        emit Register(msg.sender);
    }

    /**
    * @notice Return whether or not the BrightId user is verified
    * @param _brightIdUser The BrightId user's address
    */
    function isVerified(address _brightIdUser) external view returns (bool) {
        UserRegistration storage userRegistration = userRegistrations[_brightIdUser];

        bool hasUniqueId = userRegistration.uniqueUserId != address(0);
        bool userRegisteredWithinPeriod = getTimestamp() < userRegistration.registerTime.add(registrationPeriod);
        bool userValid = !userRegistration.addressVoid;

        return hasUniqueId && userRegisteredWithinPeriod && userValid;
    }

    /**
    * @notice Return a users unique ID, which is the first address they registered with
    * @dev Addresses that have been used as contextId's within this context that were not registered with the
    *    BrightIdRegister will not have a unique user id set and this function will revert.
    * @param _brightIdUser The BrightId user's address
    */
    function uniqueUserId(address _brightIdUser) external view returns (address) {
        UserRegistration storage userRegistration = userRegistrations[_brightIdUser];
        require(userRegistration.uniqueUserId != address(0), ERROR_NO_UNIQUE_ID_ASSIGNED);

        return userRegistration.uniqueUserId;
    }

    function _requireIsVerified(
        address[] memory _addrs,
        uint256[] _timestamps,
        uint8[] _v,
        bytes32[] _r,
        bytes32[] _s
    )
        internal view
    {
        uint256 verifiersCount = brightIdVerifiers.length;
        require(_timestamps.length == verifiersCount, ERROR_INCORRECT_TIMESTAMPS);
        require(_v.length == verifiersCount && _r.length == verifiersCount && _s.length == verifiersCount, ERROR_INCORRECT_SIGNATURES);

        for (uint256 i = 0; i < verifiersCount; i++) {
            bytes32 signedMessage = keccak256(abi.encodePacked(brightIdContext, _addrs, _timestamps[i]));
            address verifierAddress = ecrecover(signedMessage, _v[i], _r[i], _s[i]);

            require(brightIdVerifiers[i] == verifierAddress, ERROR_INCORRECT_VERIFIER);
            require(getTimestamp() < _timestamps[i].add(verificationTimestampVariance), ERROR_BAD_TIMESTAMP);
        }
    }

    /**
    * @notice Void all previously used addresses to prevent users from registering multiple times using old
    *       BrightID verifications
    */
    function _voidPreviousRegistrations(address[] memory _addrs) internal {
        if (_addrs.length <= 1) {
            return;
        }

        // Loop until we find a voided user registration, from which all
        // subsequent user registrations will already be voided
        uint256 index = 1;
        while (index < _addrs.length && !userRegistrations[_addrs[index]].addressVoid) {
            userRegistrations[_addrs[index]].addressVoid = true;
            index++;
        }
    }
}
